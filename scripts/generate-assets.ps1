Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$iconDirectory = Join-Path $projectRoot 'public\icons'
if (-not (Test-Path -LiteralPath $iconDirectory)) {
  New-Item -ItemType Directory -Path $iconDirectory | Out-Null
}

function New-FolioIcon([int]$size, [string]$path, [bool]$maskable = $false) {
  $bitmap = [System.Drawing.Bitmap]::new($size, $size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#F5F4EF'))
  $inset = if ($maskable) { [int]($size * 0.24) } else { [int]($size * 0.15) }
  $rect = [System.Drawing.Rectangle]::new($inset, $inset, $size - (2 * $inset), $size - (2 * $inset))
  $radius = [int]($size * 0.07)
  $pathShape = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $diameter = $radius * 2
  $pathShape.AddArc($rect.X, $rect.Y, $diameter, $diameter, 180, 90)
  $pathShape.AddArc($rect.Right - $diameter, $rect.Y, $diameter, $diameter, 270, 90)
  $pathShape.AddArc($rect.Right - $diameter, $rect.Bottom - $diameter, $diameter, $diameter, 0, 90)
  $pathShape.AddArc($rect.X, $rect.Bottom - $diameter, $diameter, $diameter, 90, 90)
  $pathShape.CloseFigure()
  $graphics.FillPath([System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#1B1B19')), $pathShape)
  $font = [System.Drawing.Font]::new('Georgia', [single]($size * 0.43), [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $format = [System.Drawing.StringFormat]::new()
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $brush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#F8F7F2'))
  $textRect = [System.Drawing.RectangleF]::new(0, [single](-$size * 0.022), $size, $size)
  $graphics.DrawString('F', $font, $brush, $textRect, $format)
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $format.Dispose(); $font.Dispose(); $brush.Dispose(); $pathShape.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}

function New-FolioSplash([int]$width, [int]$height, [string]$path, [bool]$dark = $false) {
  $bitmap = [System.Drawing.Bitmap]::new($width, $height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $background = if ($dark) { '#111110' } else { '#F7F7F5' }
  $foreground = if ($dark) { '#F3F3EF' } else { '#181817' }
  $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml($background))
  $font = [System.Drawing.Font]::new('Georgia', [single]($width * 0.11), [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $format = [System.Drawing.StringFormat]::new()
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $brush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml($foreground))
  $graphics.DrawString('Folio', $font, $brush, [System.Drawing.RectangleF]::new(0, 0, $width, $height), $format)
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $format.Dispose(); $font.Dispose(); $brush.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}

New-FolioIcon 180 (Join-Path $iconDirectory 'apple-touch-icon.png')
New-FolioIcon 192 (Join-Path $iconDirectory 'icon-192.png')
New-FolioIcon 512 (Join-Path $iconDirectory 'icon-512.png')
New-FolioIcon 512 (Join-Path $iconDirectory 'icon-maskable-512.png') $true
New-FolioSplash 1179 2556 (Join-Path $iconDirectory 'splash-1179x2556.png')
New-FolioSplash 1290 2796 (Join-Path $iconDirectory 'splash-1290x2796.png')
New-FolioSplash 1290 2796 (Join-Path $iconDirectory 'splash-1290x2796-dark.png') $true
