from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Sequence

from blue_dll_patch import (
    AlreadyPatchedError,
    DEFAULT_MANIFEST_PATH,
    PatchError,
    PatchValidationError,
    apply_patch,
    inspect_blue_dll,
    load_manifest,
)


def _show_startup_error(message: str) -> None:
    try:
        import ctypes

        ctypes.windll.user32.MessageBoxW(0, message, "EvEJS blue.dll Patcher", 0x10)
    except Exception:
        print(message, file=sys.stderr)


try:
    from PySide6 import QtCore, QtGui, QtWidgets
except ImportError as exc:  # pragma: no cover
    _show_startup_error(
        "PySide6 is not installed.\n\nRun:\npython -m pip install PySide6"
    )
    raise SystemExit(1) from exc


APP_TITLE = "EvEJS blue.dll Patcher"

STATE_STYLES = {
    "patchable_original": ("Ready To Patch", "#0f6b43", "#dcfce7"),
    "patchable_variant": ("Compatible Variant", "#0f6cbd", "#dbeafe"),
    "already_patched": ("Already Patched", "#124e8c", "#dbeafe"),
    "unknown": ("Unsupported Build", "#92400e", "#fef3c7"),
    "missing": ("File Missing", "#6b7280", "#e5e7eb"),
}


class FileDropLineEdit(QtWidgets.QLineEdit):
    fileDropped = QtCore.Signal(str)

    def __init__(self, parent: QtWidgets.QWidget | None = None) -> None:
        super().__init__(parent)
        self.setAcceptDrops(True)

    def dragEnterEvent(self, event: QtGui.QDragEnterEvent) -> None:  # pragma: no cover - UI behavior
        if event.mimeData().hasUrls():
            urls = [url for url in event.mimeData().urls() if url.isLocalFile()]
            if urls:
                event.acceptProposedAction()
                return
        super().dragEnterEvent(event)

    def dropEvent(self, event: QtGui.QDropEvent) -> None:  # pragma: no cover - UI behavior
        urls = [url for url in event.mimeData().urls() if url.isLocalFile()]
        if urls:
            self.fileDropped.emit(urls[0].toLocalFile())
            event.acceptProposedAction()
            return
        super().dropEvent(event)


class PatchWindow(QtWidgets.QMainWindow):
    def __init__(self, initial_path: str | None = None) -> None:
        super().__init__()
        self.manifest = load_manifest(DEFAULT_MANIFEST_PATH)
        self.initial_path = initial_path
        self.setWindowTitle(APP_TITLE)
        self.setMinimumSize(900, 720)
        self._build_ui()
        self._apply_styles()
        self._load_initial_path()
        self.refresh_inspection()

    def _build_ui(self) -> None:
        central = QtWidgets.QWidget(self)
        self.setCentralWidget(central)

        outer = QtWidgets.QVBoxLayout(central)
        outer.setContentsMargins(24, 24, 24, 24)
        outer.setSpacing(16)

        header_card = self._make_card()
        header_layout = QtWidgets.QVBoxLayout(header_card)
        header_layout.setSpacing(8)

        title = QtWidgets.QLabel(APP_TITLE)
        title.setObjectName("titleLabel")
        header_layout.addWidget(title)

        subtitle = QtWidgets.QLabel(
            "Safely patch an exact original blue.dll into the EvEJS build. "
            "Compatible hash variants can use Attempt Patch Anyway, and only count as success "
            "if the final output still matches the known EvEJS target."
        )
        subtitle.setWordWrap(True)
        subtitle.setObjectName("subtleLabel")
        header_layout.addWidget(subtitle)

        manifest_note = QtWidgets.QLabel(
            f"Manifest: {self.manifest.path.name} | "
            f"Original SHA-256: {self.manifest.source_sha256[:16]}... | "
            f"Patched SHA-256: {self.manifest.target_sha256[:16]}..."
        )
        manifest_note.setObjectName("helperLabel")
        manifest_note.setTextInteractionFlags(QtCore.Qt.TextSelectableByMouse)
        header_layout.addWidget(manifest_note)

        outer.addWidget(header_card)

        file_card = self._make_card()
        file_layout = QtWidgets.QVBoxLayout(file_card)
        file_layout.setSpacing(12)

        file_header = QtWidgets.QLabel("blue.dll to inspect")
        file_header.setObjectName("sectionLabel")
        file_layout.addWidget(file_header)

        path_row = QtWidgets.QHBoxLayout()
        path_row.setSpacing(10)
        self.input_edit = FileDropLineEdit()
        self.input_edit.setPlaceholderText("Drag blue.dll here or browse to the client's bin64 folder")
        path_row.addWidget(self.input_edit, 1)

        self.browse_button = QtWidgets.QPushButton("Browse")
        self.browse_button.setObjectName("secondaryButton")
        path_row.addWidget(self.browse_button)

        self.configured_button = QtWidgets.QPushButton("Use Configured Client")
        self.configured_button.setObjectName("secondaryButton")
        path_row.addWidget(self.configured_button)

        file_layout.addLayout(path_row)

        helper = QtWidgets.QLabel(
            "Tip: the safest choice is the client's live file, usually ...\\EVE\\tq\\bin64\\blue.dll"
        )
        helper.setObjectName("helperLabel")
        file_layout.addWidget(helper)

        outer.addWidget(file_card)

        status_card = self._make_card()
        status_layout = QtWidgets.QVBoxLayout(status_card)
        status_layout.setSpacing(14)

        top_row = QtWidgets.QHBoxLayout()
        top_row.setSpacing(12)
        self.status_badge = QtWidgets.QLabel("Waiting For File")
        self.status_badge.setObjectName("statusBadge")
        top_row.addWidget(self.status_badge, 0, QtCore.Qt.AlignLeft)
        top_row.addStretch(1)
        status_layout.addLayout(top_row)

        self.summary_label = QtWidgets.QLabel("Choose a blue.dll to inspect.")
        self.summary_label.setWordWrap(True)
        self.summary_label.setObjectName("summaryLabel")
        status_layout.addWidget(self.summary_label)

        grid = QtWidgets.QGridLayout()
        grid.setHorizontalSpacing(16)
        grid.setVerticalSpacing(8)

        self.path_value = self._make_value_label()
        self.size_value = self._make_value_label()
        self.hash_value = self._make_value_label()
        self.action_value = self._make_value_label()

        grid.addWidget(self._make_field_label("Selected File"), 0, 0)
        grid.addWidget(self.path_value, 0, 1)
        grid.addWidget(self._make_field_label("Size"), 1, 0)
        grid.addWidget(self.size_value, 1, 1)
        grid.addWidget(self._make_field_label("SHA-256"), 2, 0)
        grid.addWidget(self.hash_value, 2, 1)
        grid.addWidget(self._make_field_label("Next Step"), 3, 0)
        grid.addWidget(self.action_value, 3, 1)
        grid.setColumnStretch(1, 1)

        status_layout.addLayout(grid)
        outer.addWidget(status_card)

        options_card = self._make_card()
        options_layout = QtWidgets.QVBoxLayout(options_card)
        options_layout.setSpacing(12)

        options_label = QtWidgets.QLabel("Patch Options")
        options_label.setObjectName("sectionLabel")
        options_layout.addWidget(options_label)

        self.in_place_radio = QtWidgets.QRadioButton("Patch in place and create a backup")
        self.in_place_radio.setChecked(True)
        self.separate_radio = QtWidgets.QRadioButton("Write the patched DLL to a separate file")
        options_layout.addWidget(self.in_place_radio)
        options_layout.addWidget(self.separate_radio)

        backup_row = QtWidgets.QHBoxLayout()
        backup_row.setSpacing(10)
        backup_row.addWidget(self._make_field_label("Backup Suffix"))
        self.backup_suffix_edit = QtWidgets.QLineEdit(".original")
        self.backup_suffix_edit.setMaximumWidth(180)
        backup_row.addWidget(self.backup_suffix_edit)
        backup_row.addStretch(1)
        options_layout.addLayout(backup_row)

        output_row = QtWidgets.QHBoxLayout()
        output_row.setSpacing(10)
        self.output_edit = QtWidgets.QLineEdit()
        self.output_edit.setPlaceholderText("Separate output path")
        output_row.addWidget(self.output_edit, 1)
        self.output_browse_button = QtWidgets.QPushButton("Browse Output")
        self.output_browse_button.setObjectName("secondaryButton")
        output_row.addWidget(self.output_browse_button)
        options_layout.addLayout(output_row)

        outer.addWidget(options_card)

        action_row = QtWidgets.QHBoxLayout()
        action_row.setSpacing(10)
        self.refresh_button = QtWidgets.QPushButton("Refresh")
        self.refresh_button.setObjectName("secondaryButton")
        action_row.addWidget(self.refresh_button)

        action_row.addStretch(1)

        self.patch_button = QtWidgets.QPushButton("Patch blue.dll")
        self.patch_button.setObjectName("primaryButton")
        action_row.addWidget(self.patch_button)

        outer.addLayout(action_row)

        log_card = self._make_card()
        log_layout = QtWidgets.QVBoxLayout(log_card)
        log_layout.setSpacing(10)
        log_label = QtWidgets.QLabel("Activity")
        log_label.setObjectName("sectionLabel")
        log_layout.addWidget(log_label)

        self.log_edit = QtWidgets.QPlainTextEdit()
        self.log_edit.setReadOnly(True)
        self.log_edit.setPlaceholderText("Validation and patch messages will appear here.")
        log_layout.addWidget(self.log_edit, 1)

        outer.addWidget(log_card, 1)

        self.browse_button.clicked.connect(self._browse_input)
        self.configured_button.clicked.connect(self._use_configured_client)
        self.output_browse_button.clicked.connect(self._browse_output)
        self.refresh_button.clicked.connect(self.refresh_inspection)
        self.patch_button.clicked.connect(self._patch_selected_file)
        self.input_edit.fileDropped.connect(self._set_input_path)
        self.input_edit.textChanged.connect(self._on_input_changed)
        self.in_place_radio.toggled.connect(self._update_output_state)

    def _apply_styles(self) -> None:
        self.setStyleSheet(
            """
            QMainWindow {
                background: #edf4fb;
            }
            QFrame#card {
                background: #ffffff;
                border: 1px solid #d7e2ec;
                border-radius: 16px;
            }
            QLabel#titleLabel {
                font-size: 28px;
                font-weight: 700;
                color: #0f172a;
            }
            QLabel#sectionLabel {
                font-size: 16px;
                font-weight: 700;
                color: #102033;
            }
            QLabel#subtleLabel {
                color: #334155;
                font-size: 13px;
            }
            QLabel#helperLabel {
                color: #64748b;
                font-size: 12px;
            }
            QLabel#summaryLabel {
                color: #0f172a;
                font-size: 14px;
                font-weight: 600;
            }
            QLabel#fieldLabel {
                color: #475569;
                font-size: 12px;
                font-weight: 600;
            }
            QLabel#valueLabel {
                color: #0f172a;
                font-size: 13px;
                background: #f8fbff;
                border: 1px solid #dbe5ef;
                border-radius: 10px;
                padding: 10px 12px;
            }
            QLabel#statusBadge {
                padding: 8px 14px;
                border-radius: 999px;
                font-size: 12px;
                font-weight: 700;
            }
            QLineEdit, QPlainTextEdit {
                background: #f8fbff;
                border: 1px solid #cbd5e1;
                border-radius: 10px;
                padding: 10px 12px;
                selection-background-color: #b6dbff;
            }
            QLineEdit:focus, QPlainTextEdit:focus {
                border: 1px solid #3b82f6;
            }
            QPushButton {
                min-height: 40px;
                border-radius: 10px;
                padding: 0 14px;
                font-weight: 600;
            }
            QPushButton#primaryButton {
                background: #0f6cbd;
                color: white;
                border: none;
            }
            QPushButton#primaryButton:hover {
                background: #115ea3;
            }
            QPushButton#primaryButton:disabled {
                background: #94a3b8;
            }
            QPushButton#secondaryButton {
                background: #f8fbff;
                color: #0f172a;
                border: 1px solid #cbd5e1;
            }
            QPushButton#secondaryButton:hover {
                background: #eef6ff;
            }
            QRadioButton {
                color: #0f172a;
                spacing: 8px;
            }
            """
        )

    def _make_card(self) -> QtWidgets.QFrame:
        frame = QtWidgets.QFrame()
        frame.setObjectName("card")
        return frame

    def _make_field_label(self, text: str) -> QtWidgets.QLabel:
        label = QtWidgets.QLabel(text)
        label.setObjectName("fieldLabel")
        return label

    def _make_value_label(self) -> QtWidgets.QLabel:
        label = QtWidgets.QLabel("—")
        label.setObjectName("valueLabel")
        label.setWordWrap(True)
        label.setTextInteractionFlags(QtCore.Qt.TextSelectableByMouse)
        return label

    def _load_initial_path(self) -> None:
        initial = self.initial_path or self._configured_blue_dll()
        if initial:
            self.input_edit.setText(initial)
        self._update_output_state()

    def _configured_blue_dll(self) -> str | None:
        configured_root = os.environ.get("EVEJS_CLIENT_PATH")
        if configured_root:
            candidate = Path(configured_root) / "bin64" / "blue.dll"
            return str(candidate)

        repo_candidate = Path(__file__).resolve().parents[2] / "client" / "EVE" / "tq" / "bin64" / "blue.dll"
        if repo_candidate.exists():
            return str(repo_candidate)

        return None

    def _set_input_path(self, path: str) -> None:
        self.input_edit.setText(path)

    def _on_input_changed(self) -> None:
        self._update_output_state()
        self.refresh_inspection()

    def _browse_input(self) -> None:
        start_dir = str(Path(self.input_edit.text()).parent) if self.input_edit.text() else str(Path.home())
        selected, _ = QtWidgets.QFileDialog.getOpenFileName(
            self,
            "Choose blue.dll",
            start_dir,
            "DLL files (*.dll);;All files (*.*)",
        )
        if selected:
            self.input_edit.setText(selected)

    def _browse_output(self) -> None:
        start_file = self.output_edit.text() or self._default_output_text()
        selected, _ = QtWidgets.QFileDialog.getSaveFileName(
            self,
            "Save patched blue.dll",
            start_file,
            "DLL files (*.dll);;All files (*.*)",
        )
        if selected:
            self.output_edit.setText(selected)

    def _use_configured_client(self) -> None:
        candidate = self._configured_blue_dll()
        if candidate:
            self.input_edit.setText(candidate)
            self._append_log(f"Loaded configured client path: {candidate}")
        else:
            self._append_log("No configured client path was found.")

    def _default_output_text(self) -> str:
        input_text = self.input_edit.text().strip()
        if not input_text:
            return ""
        path = Path(input_text)
        return str(path.with_name(f"{path.stem}.patched{path.suffix}"))

    def _update_output_state(self) -> None:
        separate = self.separate_radio.isChecked()
        self.output_edit.setEnabled(separate)
        self.output_browse_button.setEnabled(separate)
        if separate and not self.output_edit.text().strip():
            self.output_edit.setText(self._default_output_text())
        if not separate:
            self.output_edit.setPlaceholderText("Disabled while patching in place")

    def _append_log(self, message: str) -> None:
        self.log_edit.appendPlainText(message)

    def refresh_inspection(self) -> None:
        input_text = self.input_edit.text().strip()
        if not input_text:
            self._set_status(
                "missing",
                "Choose a blue.dll to inspect.",
                "Pick a file from the EVE client's bin64 folder.",
                "—",
                "—",
                "—",
            )
            self.patch_button.setEnabled(False)
            self.patch_button.setText("Patch blue.dll")
            return

        result = inspect_blue_dll(input_text, self.manifest)
        size_text = f"{result.size:,} bytes" if result.size is not None else "—"
        hash_text = result.sha256 or "—"

        self._set_status(
            result.state,
            result.summary,
            str(result.path),
            size_text,
            hash_text,
            result.action,
        )

        self.patch_button.setEnabled(result.can_patch)
        self.patch_button.setText(
            "Attempt Patch Anyway" if result.state == "patchable_variant" else "Patch blue.dll"
        )

    def _set_status(
        self,
        state: str,
        summary: str,
        path_text: str,
        size_text: str,
        hash_text: str,
        action_text: str,
    ) -> None:
        label_text, fg, bg = STATE_STYLES.get(state, STATE_STYLES["unknown"])
        self.status_badge.setText(label_text)
        self.status_badge.setStyleSheet(
            f"color: {fg}; background: {bg}; border: 1px solid {bg};"
        )
        self.summary_label.setText(summary)
        self.path_value.setText(path_text)
        self.size_value.setText(size_text)
        self.hash_value.setText(hash_text)
        self.action_value.setText(action_text)

    def _patch_selected_file(self) -> None:
        input_path = self.input_edit.text().strip()
        if not input_path:
            QtWidgets.QMessageBox.warning(self, APP_TITLE, "Choose a blue.dll first.")
            return

        try:
            inspection = inspect_blue_dll(input_path, self.manifest)
            allow_relaxed_variant = inspection.state == "patchable_variant"
            if self.in_place_radio.isChecked():
                result = apply_patch(
                    input_path,
                    in_place=True,
                    backup_suffix=self.backup_suffix_edit.text().strip() or ".original",
                    manifest=self.manifest,
                    allow_relaxed_variant=allow_relaxed_variant,
                )
            else:
                output_text = self.output_edit.text().strip() or self._default_output_text()
                result = apply_patch(
                    input_path,
                    output_path=output_text,
                    in_place=False,
                    manifest=self.manifest,
                    allow_relaxed_variant=allow_relaxed_variant,
                )
        except AlreadyPatchedError as exc:
            self._append_log(str(exc))
            QtWidgets.QMessageBox.information(self, APP_TITLE, str(exc))
        except PatchValidationError as exc:
            self._append_log(f"Validation failed: {exc}")
            QtWidgets.QMessageBox.warning(self, APP_TITLE, str(exc))
        except PatchError as exc:
            self._append_log(f"Patch failed: {exc}")
            QtWidgets.QMessageBox.critical(self, APP_TITLE, str(exc))
        except Exception as exc:  # pragma: no cover
            self._append_log(f"Unexpected error: {exc}")
            QtWidgets.QMessageBox.critical(self, APP_TITLE, f"Unexpected error:\n{exc}")
        else:
            if result.used_relaxed_validation:
                self._append_log(
                    "Attempt Patch Anyway succeeded and the output matches the canonical EvEJS target hash."
                )
            self._append_log(f"Patched successfully: {result.output_path}")
            self._append_log(f"SHA-256: {result.sha256}")
            if result.backup_path is not None:
                suffix_status = "created" if result.backup_created else "already existed"
                self._append_log(f"Backup: {result.backup_path} ({suffix_status})")

            message = [f"Patched successfully:\n{result.output_path}", "", f"SHA-256:\n{result.sha256}"]
            if result.used_relaxed_validation:
                message.extend(
                    [
                        "",
                        "Attempt Patch Anyway verification passed.",
                        "The final file matches the canonical EvEJS target hash.",
                    ]
                )
            if result.backup_path is not None:
                message.extend(["", f"Backup:\n{result.backup_path}"])
            QtWidgets.QMessageBox.information(self, APP_TITLE, "\n".join(message))
            self.refresh_inspection()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Launch the EvEJS blue.dll patch GUI.")
    parser.add_argument(
        "--path",
        "--input",
        dest="initial_path",
        help="Optional blue.dll path to prefill in the GUI.",
    )
    parser.add_argument("input_path", nargs="?", help=argparse.SUPPRESS)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args, _unknown = build_parser().parse_known_args(argv)
    app = QtWidgets.QApplication(sys.argv[:1])
    app.setApplicationName(APP_TITLE)
    app.setStyle("Fusion")

    window = PatchWindow(initial_path=args.initial_path or args.input_path)
    window.show()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
