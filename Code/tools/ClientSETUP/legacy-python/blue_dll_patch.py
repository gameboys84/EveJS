from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import shutil
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence


CLIENT_SETUP_DIR = Path(__file__).resolve().parent
DEFAULT_MANIFEST_PATH = CLIENT_SETUP_DIR / "blue-dll.patch.json"


class PatchError(Exception):
    """Base error for blue.dll patching."""


class PatchValidationError(PatchError):
    """The selected file is not safe to patch."""


class AlreadyPatchedError(PatchValidationError):
    """The selected file already matches the target patch."""


@dataclass(frozen=True)
class FixedPatch:
    offset: int
    offset_hex: str
    description: str
    before: bytes
    after: bytes
    allow_mismatched_before: bool


@dataclass(frozen=True)
class OverlayPatch:
    offset: int
    offset_hex: str
    description: str
    before_size: int
    after_size: int
    before_sha256: str
    after_sha256: str
    compression: str
    data_base64: str
    allow_mismatched_before_sha256: bool


@dataclass(frozen=True)
class PatchManifest:
    name: str
    description: str
    source_filename: str
    source_size: int
    source_sha256: str
    target_filename: str
    target_size: int
    target_sha256: str
    patches: tuple[FixedPatch, ...]
    overlay: OverlayPatch | None
    path: Path


@dataclass(frozen=True)
class InspectionResult:
    path: Path
    exists: bool
    size: int | None
    sha256: str | None
    state: str
    summary: str
    action: str
    manifest: PatchManifest

    @property
    def can_patch(self) -> bool:
        return self.state in {"patchable_original", "patchable_variant"}


@dataclass(frozen=True)
class PatchResult:
    input_path: Path
    output_path: Path
    backup_path: Path | None
    backup_created: bool
    sha256: str
    size: int
    manifest: PatchManifest
    used_relaxed_validation: bool


def load_manifest(manifest_path: str | Path = DEFAULT_MANIFEST_PATH) -> PatchManifest:
    manifest_file = Path(manifest_path).resolve()
    raw = json.loads(manifest_file.read_text(encoding="utf-8"))

    patches = tuple(
        FixedPatch(
            offset=patch["offset"],
            offset_hex=patch["offsetHex"],
            description=patch["description"],
            before=bytes.fromhex(patch["beforeHex"]),
            after=bytes.fromhex(patch["afterHex"]),
            allow_mismatched_before=patch.get("allowMismatchedBefore", False),
        )
        for patch in raw.get("patches", [])
    )

    overlay_raw = raw.get("overlay")
    overlay = None
    if overlay_raw:
        overlay = OverlayPatch(
            offset=overlay_raw["offset"],
            offset_hex=overlay_raw["offsetHex"],
            description=overlay_raw["description"],
            before_size=overlay_raw["beforeSize"],
            after_size=overlay_raw["afterSize"],
            before_sha256=overlay_raw["beforeSha256"],
            after_sha256=overlay_raw["afterSha256"],
            compression=overlay_raw["compression"],
            data_base64=overlay_raw["dataBase64"],
            allow_mismatched_before_sha256=overlay_raw.get(
                "allowMismatchedBeforeSha256", False
            ),
        )

    return PatchManifest(
        name=raw["name"],
        description=raw["description"],
        source_filename=raw["source"]["filename"],
        source_size=raw["source"]["size"],
        source_sha256=raw["source"]["sha256"],
        target_filename=raw["target"]["filename"],
        target_size=raw["target"]["size"],
        target_sha256=raw["target"]["sha256"],
        patches=patches,
        overlay=overlay,
        path=manifest_file,
    )


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: str | Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def _read_file_bytes(path: Path) -> bytes:
    try:
        return path.read_bytes()
    except OSError as exc:
        raise PatchError(f"Failed to read {path}: {exc}") from exc


def inspect_blue_dll(path: str | Path, manifest: PatchManifest | None = None) -> InspectionResult:
    manifest = manifest or load_manifest()
    candidate = Path(path).expanduser().resolve()

    if not candidate.exists():
        return InspectionResult(
            path=candidate,
            exists=False,
            size=None,
            sha256=None,
            state="missing",
            summary="File not found.",
            action="Choose a blue.dll from the EVE client's bin64 folder.",
            manifest=manifest,
        )

    if not candidate.is_file():
        return InspectionResult(
            path=candidate,
            exists=False,
            size=None,
            sha256=None,
            state="missing",
            summary="That path is not a file.",
            action="Choose the actual blue.dll file, not a folder.",
            manifest=manifest,
        )

    size = candidate.stat().st_size
    file_hash = sha256_file(candidate)

    if size == manifest.target_size and file_hash == manifest.target_sha256:
        return InspectionResult(
            path=candidate,
            exists=True,
            size=size,
            sha256=file_hash,
            state="already_patched",
            summary="This file already matches the EvEJS patched blue.dll.",
            action="No patch is needed.",
            manifest=manifest,
        )

    if size == manifest.source_size and file_hash == manifest.source_sha256:
        return InspectionResult(
            path=candidate,
            exists=True,
            size=size,
            sha256=file_hash,
            state="patchable_original",
            summary="Exact original build detected. Safe to patch.",
            action="Ready to patch to the EvEJS version.",
            manifest=manifest,
        )

    if size == manifest.source_size:
        source_bytes = _read_file_bytes(candidate)
        try:
            _apply_patch_bytes(source_bytes, manifest, allow_relaxed_variant=True)
        except PatchError:
            pass
        else:
            return InspectionResult(
                path=candidate,
                exists=True,
                size=size,
                sha256=file_hash,
                state="patchable_variant",
                summary=(
                    "This blue.dll differs from the recorded source hash, but a relaxed dry run "
                    "still reaches the exact EvEJS patched target."
                ),
                action=(
                    "Use Attempt Patch Anyway to patch and verify against the known-good target hash."
                ),
                manifest=manifest,
            )

    if size == manifest.source_size:
        summary = "This looks like an unpatched blue.dll, but not the exact supported build."
    elif size == manifest.target_size:
        summary = "This looks close to the patched size, but it is not the EvEJS target build."
    else:
        summary = "This file does not match the supported original or patched blue.dll sizes."

    return InspectionResult(
        path=candidate,
        exists=True,
        size=size,
        sha256=file_hash,
        state="unknown",
        summary=summary,
        action="Do not patch this file unless you add a manifest for its exact build.",
        manifest=manifest,
    )


def _inflate_overlay(overlay: OverlayPatch) -> bytes:
    if overlay.compression != "deflate":
        raise PatchError(f"Unsupported overlay compression: {overlay.compression}")

    try:
        inflated = zlib.decompress(base64.b64decode(overlay.data_base64))
    except Exception as exc:
        raise PatchError("Failed to decode the overlay payload from the patch manifest.") from exc

    if len(inflated) != overlay.after_size:
        raise PatchError(
            f"Overlay size mismatch after decode. Expected {overlay.after_size}, got {len(inflated)}."
        )

    if sha256_bytes(inflated) != overlay.after_sha256:
        raise PatchError("Decoded overlay SHA-256 does not match the patch manifest.")

    return inflated


def apply_patch_bytes(source_bytes: bytes, manifest: PatchManifest | None = None) -> bytes:
    return _apply_patch_bytes(source_bytes, manifest, allow_relaxed_variant=False)


def _apply_patch_bytes(
    source_bytes: bytes,
    manifest: PatchManifest | None = None,
    *,
    allow_relaxed_variant: bool = False,
) -> bytes:
    manifest = manifest or load_manifest()
    source_hash = sha256_bytes(source_bytes)
    is_exact_source = len(source_bytes) == manifest.source_size and source_hash == manifest.source_sha256

    if len(source_bytes) == manifest.target_size and source_hash == manifest.target_sha256:
        raise AlreadyPatchedError("This blue.dll is already patched.")
    if len(source_bytes) != manifest.source_size:
        raise PatchValidationError(
            "This blue.dll does not match the supported original size and will not be patched."
        )
    if not is_exact_source and not allow_relaxed_variant:
        raise PatchValidationError(
            "This blue.dll does not match the exact supported original build and will not be patched."
        )

    patched = bytearray(source_bytes)

    for patch in manifest.patches:
        current = bytes(patched[patch.offset : patch.offset + len(patch.before)])
        if current != patch.before and not patch.allow_mismatched_before:
            raise PatchValidationError(
                f"Unexpected bytes at {patch.offset_hex}. Expected {patch.before.hex()}, got {current.hex()}."
            )
        patched[patch.offset : patch.offset + len(patch.after)] = patch.after

    if manifest.overlay is not None:
        overlay = manifest.overlay
        source_overlay = source_bytes[overlay.offset :]
        if len(source_overlay) != overlay.before_size:
            raise PatchValidationError(
                f"Unexpected source overlay size. Expected {overlay.before_size}, got {len(source_overlay)}."
            )
        source_overlay_sha = sha256_bytes(source_overlay)
        if source_overlay_sha != overlay.before_sha256 and not overlay.allow_mismatched_before_sha256:
            raise PatchValidationError("Source overlay SHA-256 does not match the manifest.")

        patched_overlay = _inflate_overlay(overlay)
        patched = bytearray(patched[: overlay.offset] + patched_overlay)

    final_bytes = bytes(patched)
    if len(final_bytes) != manifest.target_size:
        raise PatchError(
            f"Patched output size mismatch. Expected {manifest.target_size}, got {len(final_bytes)}."
        )

    final_hash = sha256_bytes(final_bytes)
    if final_hash != manifest.target_sha256:
        raise PatchError(
            "Patched output SHA-256 does not match the target manifest hash."
        )

    return final_bytes


def _default_output_path(input_path: Path) -> Path:
    return input_path.with_name(f"{input_path.stem}.patched{input_path.suffix}")


def _write_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(f"{path.name}.tmp")
    try:
        temp_path.write_bytes(data)
        os.replace(temp_path, path)
    finally:
        if temp_path.exists():
            try:
                temp_path.unlink()
            except OSError:
                pass


def apply_patch(
    input_path: str | Path,
    *,
    output_path: str | Path | None = None,
    in_place: bool = False,
    backup_suffix: str = ".original",
    manifest: PatchManifest | None = None,
    force: bool = False,
    allow_relaxed_variant: bool = False,
) -> PatchResult:
    manifest = manifest or load_manifest()
    candidate = Path(input_path).expanduser().resolve()
    inspection = inspect_blue_dll(candidate, manifest)

    if inspection.state == "already_patched":
        raise AlreadyPatchedError("This blue.dll already matches the EvEJS patched build.")
    if not inspection.can_patch:
        raise PatchValidationError(inspection.summary)
    if inspection.state == "patchable_variant" and not allow_relaxed_variant:
        raise PatchValidationError(
            "This blue.dll needs Attempt Patch Anyway because its source hash differs from the recorded build."
        )

    source_bytes = _read_file_bytes(candidate)
    patched_bytes = _apply_patch_bytes(
        source_bytes,
        manifest,
        allow_relaxed_variant=allow_relaxed_variant,
    )

    backup_path: Path | None = None
    backup_created = False

    if in_place:
        output = candidate
        backup_path = candidate.with_name(f"{candidate.name}{backup_suffix}")
        if not backup_path.exists():
            shutil.copy2(candidate, backup_path)
            backup_created = True
    else:
        output = Path(output_path).expanduser().resolve() if output_path else _default_output_path(candidate)
        if output.exists() and not force:
            raise PatchValidationError(
                f"Output file already exists: {output}. Choose another path or enable overwrite."
            )

    _write_atomic(output, patched_bytes)

    return PatchResult(
        input_path=candidate,
        output_path=output,
        backup_path=backup_path,
        backup_created=backup_created,
        sha256=sha256_bytes(patched_bytes),
        size=len(patched_bytes),
        manifest=manifest,
        used_relaxed_validation=allow_relaxed_variant,
    )


def format_inspection(result: InspectionResult) -> str:
    lines = [
        f"Path:    {result.path}",
        f"State:   {result.state}",
        f"Summary: {result.summary}",
        f"Action:  {result.action}",
    ]
    if result.size is not None:
        lines.append(f"Size:    {result.size}")
    if result.sha256 is not None:
        lines.append(f"SHA-256: {result.sha256}")
    return "\n".join(lines)


def format_patch_result(result: PatchResult) -> str:
    lines = [
        f"Input:   {result.input_path}",
        f"Output:  {result.output_path}",
        f"Size:    {result.size}",
        f"SHA-256: {result.sha256}",
    ]
    if result.used_relaxed_validation:
        lines.append("Mode:    relaxed compatibility")
    if result.backup_path is not None:
        status = "created" if result.backup_created else "already existed"
        lines.append(f"Backup:  {result.backup_path} ({status})")
    return "\n".join(lines)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Apply or inspect the EvEJS blue.dll patch.")
    parser.add_argument("--input", required=True, help="Path to the blue.dll to inspect or patch.")
    parser.add_argument("--inspect", action="store_true", help="Inspect only; do not patch.")
    parser.add_argument("--output", help="Path for the patched file when not patching in place.")
    parser.add_argument("--in-place", action="store_true", help="Patch the selected file in place.")
    parser.add_argument(
        "--backup-suffix",
        default=".original",
        help="Backup suffix used for --in-place. Default: .original",
    )
    parser.add_argument("--manifest", default=str(DEFAULT_MANIFEST_PATH), help="Path to the patch manifest.")
    parser.add_argument("--force", action="store_true", help="Overwrite an existing output path.")
    parser.add_argument(
        "--attempt-anyway",
        action="store_true",
        help="Try a compatible hash variant and only succeed if the final output still matches the known target hash.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    manifest = load_manifest(args.manifest)

    if args.inspect:
        result = inspect_blue_dll(args.input, manifest)
        print(format_inspection(result))
        return 0

    result = apply_patch(
        args.input,
        output_path=args.output,
        in_place=args.in_place,
        backup_suffix=args.backup_suffix,
        manifest=manifest,
        force=args.force,
        allow_relaxed_variant=args.attempt_anyway,
    )
    print(format_patch_result(result))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except PatchError as exc:
        print(str(exc))
        raise SystemExit(1) from exc
