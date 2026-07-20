param(
  [string]$ClientPath,
  [switch]$ForceRebuildGatewayCert,
  [switch]$SkipRootStore,
  [switch]$SkipClientBundles
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$caCertPath = Join-Path $repoRoot "server\certs\xmpp-ca-cert.pem"
$caKeyPath = Join-Path $repoRoot "server\certs\xmpp-ca-key.pem"
$builderScriptPath = Join-Path $PSScriptRoot "build-gateway-cert.js"
$xmppCertDir = Join-Path $repoRoot "server\certs"
$xmppCertPath = Join-Path $xmppCertDir "xmpp-dev-cert.pem"
$xmppKeyPath = Join-Path $xmppCertDir "xmpp-dev-key.pem"
$gatewayCertDir = Join-Path $repoRoot "server\src\_secondary\express\certs"
$gatewayCertPath = Join-Path $gatewayCertDir "gateway-dev-cert.pem"
$gatewayKeyPath = Join-Path $gatewayCertDir "gateway-dev-key.pem"
$gatewayFriendlyName = "eve.js Public Gateway TLS"
$gatewaySubject = "CN=dev-public-gateway.evetech.net"

function Write-Step {
  param([string]$Message)

  Write-Host "[eve.js] $Message" -ForegroundColor Cyan
}

function Get-NodeCommand {
  $nodeCommand = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
  if (-not $nodeCommand) {
    $nodeCommand = (Get-Command node -ErrorAction Stop).Source
  }

  return $nodeCommand
}

function Ensure-LocalCertificateFiles {
  New-Item -ItemType Directory -Force -Path $xmppCertDir | Out-Null

  if (Test-LeafNeedsRebuild `
    -CertPath $xmppCertPath `
    -KeyPath $xmppKeyPath `
    -RequiredDnsNames @("localhost")) {
    Invoke-CertificateBuilder `
      -OutCertPath $xmppCertPath `
      -OutKeyPath $xmppKeyPath `
      -CommonName "localhost" `
      -DnsNames @("localhost") `
      -IpNames @("127.0.0.1")
    Write-Step "Built CA-signed XMPP TLS cert under $xmppCertDir"
  }
}

function Resolve-ConfiguredClientPath {
  param([string]$ConfiguredPath)

  $candidates = @()
  if ($ConfiguredPath) {
    $candidates += $ConfiguredPath
  }
  if ($env:EVEJS_CLIENT_PATH) {
    $candidates += $env:EVEJS_CLIENT_PATH
  }
  $repoClientPath = Join-Path $repoRoot "client\EVE\tq"
  if (Test-Path $repoClientPath) {
    $candidates += $repoClientPath
  }

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) {
      return (Resolve-Path -Path $candidate).Path
    }
  }

  return $null
}

function Get-ClientBundlePaths {
  param([string]$ResolvedClientPath)

  if (-not $ResolvedClientPath) {
    return @()
  }

  $fixedPaths = @(
    (Join-Path $ResolvedClientPath "bin64\cacert.pem"),
    (Join-Path $ResolvedClientPath "bin64\packages\certifi\cacert.pem"),
    (Join-Path $ResolvedClientPath "bin\cacert.pem"),
    (Join-Path $ResolvedClientPath "bin\packages\certifi\cacert.pem")
  ) | Where-Object { Test-Path $_ }

  $recursivePaths = @(Get-ChildItem -LiteralPath $ResolvedClientPath -Recurse -Filter "cacert.pem" -File -ErrorAction SilentlyContinue |
    ForEach-Object { $_.FullName })

  return @($fixedPaths + $recursivePaths |
    Where-Object { $_ } |
    ForEach-Object { (Resolve-Path -LiteralPath $_).Path } |
    Sort-Object -Unique)
}

function Remove-PemBlockFromContent {
  param(
    [string]$Content,
    [string]$PemBlock
  )

  if (-not $PemBlock) {
    return $Content
  }

  $trimmedPem = $PemBlock.Trim()
  if (-not $trimmedPem) {
    return $Content
  }

  return ($Content -replace [regex]::Escape($trimmedPem), "").TrimEnd() + "`r`n"
}

function Convert-PemBlockToCertificate {
  param([string]$PemBlock)

  $base64 = ($PemBlock `
    -replace "-----BEGIN CERTIFICATE-----", "" `
    -replace "-----END CERTIFICATE-----", "" `
    -replace "\s", "")

  if (-not $base64) {
    return $null
  }

  try {
    $bytes = [Convert]::FromBase64String($base64)
    return New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 -ArgumentList @(,$bytes)
  } catch {
    return $null
  }
}

function Remove-EvEJSLocalCertificateBlocksFromContent {
  param(
    [string]$Content,
    [string]$CurrentCaThumbprint
  )

  if (-not $Content) {
    return ""
  }

  $regex = New-Object System.Text.RegularExpressions.Regex(
    "-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----",
    [System.Text.RegularExpressions.RegexOptions]::Multiline
  )

  $updated = $regex.Replace(
    $Content,
    [System.Text.RegularExpressions.MatchEvaluator]{
      param($match)

      $cert = Convert-PemBlockToCertificate -PemBlock $match.Value
      if ($cert) {
        $subject = [string]$cert.Subject
        $issuer = [string]$cert.Issuer
        $thumbprint = [string]$cert.Thumbprint
        if (
          $subject -like "*EvEJS Local*" -or
          $issuer -like "*EvEJS Local*" -or
          $subject -like "*eve.js Public Gateway TLS*" -or
          $issuer -like "*eve.js Public Gateway TLS*"
        ) {
          if ($CurrentCaThumbprint -and $thumbprint -eq $CurrentCaThumbprint) {
            return $match.Value
          }
          return ""
        }
      }

      return $match.Value
    }
  )

  return $updated.TrimEnd() + "`r`n"
}

function Ensure-PemBundleContainsCa {
  param(
    [string]$BundlePath,
    [string]$PemCaPath,
    [string[]]$PemBlocksToRemove = @()
  )

  $bundleRaw = Get-Content -LiteralPath $BundlePath -Raw
  foreach ($pemBlock in $PemBlocksToRemove) {
    $bundleRaw = Remove-PemBlockFromContent -Content $bundleRaw -PemBlock $pemBlock
  }

  $caRaw = (Get-Content -LiteralPath $PemCaPath -Raw).Trim()
  $caCert = Get-PfxCertificate -FilePath $PemCaPath
  $bundleRaw = Remove-EvEJSLocalCertificateBlocksFromContent `
    -Content $bundleRaw `
    -CurrentCaThumbprint $caCert.Thumbprint

  if ($bundleRaw.Contains($caRaw)) {
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($BundlePath, $bundleRaw, $encoding)
    Write-Step "CA already present in $BundlePath"
    return
  }

  $updated = $bundleRaw.TrimEnd() + "`r`n`r`n" + $caRaw + "`r`n"
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($BundlePath, $updated, $encoding)
  $verifyRaw = Get-Content -LiteralPath $BundlePath -Raw
  if (-not $verifyRaw.Contains($caRaw)) {
    throw "Failed to verify EvEJS CA inside $BundlePath after writing."
  }
  Write-Step "Appended CA to $BundlePath"
}

function Ensure-RootTrust {
  param([string]$PemPath)

  $cert = Get-PfxCertificate -FilePath $PemPath
  $staleCerts = @(Get-ChildItem Cert:\CurrentUser\Root -ErrorAction SilentlyContinue | Where-Object {
    (
      $_.Subject -like "*EvEJS Local*" -or
      $_.Issuer -like "*EvEJS Local*"
    ) -and $_.Thumbprint -ne $cert.Thumbprint
  })

  foreach ($staleCert in $staleCerts) {
    Remove-Item -Path (Join-Path "Cert:\CurrentUser\Root" $staleCert.Thumbprint) -ErrorAction SilentlyContinue
  }
  if ($staleCerts.Count -gt 0) {
    Write-Step "Removed $($staleCerts.Count) stale EvEJS CA certificate(s) from CurrentUser\Root."
  }

  $existing = Get-ChildItem Cert:\CurrentUser\Root | Where-Object {
    $_.Thumbprint -eq $cert.Thumbprint
  }

  if ($existing) {
    Write-Step "CA already trusted in CurrentUser\Root."
    return
  }

  Import-Certificate -FilePath $PemPath -CertStoreLocation Cert:\CurrentUser\Root | Out-Null
  Write-Step "Installed CA into CurrentUser\Root."
}

function Remove-ExistingGatewayCerts {
  $stores = @("Cert:\CurrentUser\My", "Cert:\CurrentUser\Root")
  foreach ($store in $stores) {
    $existing = Get-ChildItem $store | Where-Object {
      $_.FriendlyName -eq $gatewayFriendlyName -or $_.Subject -eq $gatewaySubject
    }

    foreach ($cert in $existing) {
      Remove-Item -Path (Join-Path $store $cert.Thumbprint) -DeleteKey -ErrorAction SilentlyContinue
    }
  }
}

function Test-LeafNeedsRebuild {
  param(
    [string]$CertPath,
    [string]$KeyPath,
    [string[]]$RequiredDnsNames
  )

  if ((-not (Test-Path $CertPath)) -or (-not (Test-Path $KeyPath))) {
    return $true
  }
  if ((-not (Test-Path $caCertPath)) -or (-not (Test-Path $caKeyPath))) {
    return $true
  }

  try {
    $cert = Get-PfxCertificate -FilePath $CertPath
    $caCert = Get-PfxCertificate -FilePath $caCertPath
    if ([string]::Equals($cert.Subject, $cert.Issuer, [System.StringComparison]::OrdinalIgnoreCase)) {
      return $true
    }
    if (-not [string]::Equals($cert.Issuer, $caCert.Subject, [System.StringComparison]::OrdinalIgnoreCase)) {
      return $true
    }

    $dnsNames = @($cert.DnsNameList | ForEach-Object { $_.Unicode.ToLowerInvariant() })
    foreach ($requiredName in $RequiredDnsNames) {
      if ($dnsNames -notcontains $requiredName) {
        return $true
      }
    }

    return $false
  } catch {
    return $true
  }
}

function Invoke-CertificateBuilder {
  param(
    [string]$OutCertPath,
    [string]$OutKeyPath,
    [string]$CommonName,
    [string[]]$DnsNames,
    [string[]]$IpNames
  )

  $nodeCommand = Get-NodeCommand
  & $nodeCommand $builderScriptPath `
    --ensure-ca `
    --ca-cert $caCertPath `
    --ca-key $caKeyPath `
    --common-name $CommonName `
    --dns ($DnsNames -join ",") `
    --ip ($IpNames -join ",") `
    --out-cert $OutCertPath `
    --out-key $OutKeyPath

  if ($LASTEXITCODE -ne 0) {
    throw "Failed to build local TLS certificate for $CommonName."
  }
}

function Build-GatewayCertificate {
  New-Item -ItemType Directory -Force -Path $gatewayCertDir | Out-Null

  $previousLeafPem = $null
  if (Test-Path $gatewayCertPath) {
    $previousLeafPem = (Get-Content -Path $gatewayCertPath -Raw).Trim()
  }

  if ($ForceRebuildGatewayCert) {
    Remove-ExistingGatewayCerts
    Remove-Item -Path $gatewayCertPath, $gatewayKeyPath -Force -ErrorAction SilentlyContinue
  }

  if (-not (Test-LeafNeedsRebuild `
    -CertPath $gatewayCertPath `
    -KeyPath $gatewayKeyPath `
    -RequiredDnsNames @("dev-public-gateway.evetech.net", "public-gateway.evetech.net", "localhost"))) {
    Write-Step "Gateway TLS files already exist."
    return $previousLeafPem
  }

  Invoke-CertificateBuilder `
    -OutCertPath $gatewayCertPath `
    -OutKeyPath $gatewayKeyPath `
    -CommonName "dev-public-gateway.evetech.net" `
    -DnsNames @("dev-public-gateway.evetech.net", "public-gateway.evetech.net", "localhost") `
    -IpNames @("127.0.0.1")

  Write-Step "Built CA-signed public-gateway TLS cert under $gatewayCertDir"
  return $previousLeafPem
}

Ensure-LocalCertificateFiles

if (-not (Test-Path $caCertPath)) {
  throw "Missing CA certificate at $caCertPath"
}

if (-not (Test-Path $caKeyPath)) {
  throw "Missing CA private key at $caKeyPath"
}

$oldLeafPem = Build-GatewayCertificate

if (-not $SkipRootStore) {
  Ensure-RootTrust -PemPath $caCertPath
}

if (-not $SkipClientBundles) {
  $resolvedClientPath = Resolve-ConfiguredClientPath -ConfiguredPath $ClientPath
  if (-not $resolvedClientPath) {
    throw "Client path was not found. Edit tools\ClientSETUP\scripts\EvEJSConfig.bat or pass -ClientPath."
  }

  $bundlePaths = Get-ClientBundlePaths -ResolvedClientPath $resolvedClientPath
  if (-not $bundlePaths) {
    throw "No client cacert.pem bundle was found under $resolvedClientPath"
  }

  $currentLeafPem = $null
  if (Test-Path $gatewayCertPath) {
    $currentLeafPem = (Get-Content -Path $gatewayCertPath -Raw).Trim()
  }

  foreach ($bundlePath in $bundlePaths) {
    Ensure-PemBundleContainsCa `
      -BundlePath $bundlePath `
      -PemCaPath $caCertPath `
      -PemBlocksToRemove @($oldLeafPem, $currentLeafPem)
  }
}

Write-Step "Chat and public-gateway certificates are ready."
