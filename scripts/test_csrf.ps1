$s = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$csrf = Invoke-RestMethod -Uri 'http://localhost:3000/api/csrf' -Method Get -WebSession $s -Headers @{Origin='https://your-tunnel-id.devtunnels.ms'}
$token = $csrf.csrfToken
Write-Host "CSRF token: $token"
Write-Host 'Cookies:' ($s.Cookies.GetCookies('http://localhost:3000') | ForEach-Object { $_.Name + '=' + $_.Value })
try {
  $res = Invoke-RestMethod -Uri 'http://localhost:3000/api/agents' -Method Post -WebSession $s -Headers @{ 'X-CSRF-Token'=$token; Origin='https://your-tunnel-id.devtunnels.ms'} -Body (@{account='test'; password='p'; name='T'} | ConvertTo-Json) -ContentType 'application/json'
  Write-Host "POST /api/agents succeeded:" ($res | ConvertTo-Json)
} catch {
  Write-Host 'With-token Error status:' $_.Exception.Response.StatusCode.Value__
  Write-Host 'With-token Error Desc:' $_.Exception.Response.StatusDescription
}

# Try without CSRF token
try {
  $s2 = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $res = Invoke-RestMethod -Uri 'http://localhost:3000/api/agents' -Method Post -WebSession $s2 -Headers @{ Origin='https://your-tunnel-id.devtunnels.ms'} -Body (@{account='test2'; password='p2'; name='T2'} | ConvertTo-Json) -ContentType 'application/json'
  Write-Host "POST /api/agents without token succeeded:" ($res | ConvertTo-Json)
} catch {
  Write-Host 'No-token Error status:' $_.Exception.Response.StatusCode.Value__
  Write-Host 'No-token Error Desc:' $_.Exception.Response.StatusDescription
}

# Test public ticket creation
try {
  $ticket = Invoke-RestMethod -Uri 'http://localhost:3000/api/tickets' -Method Post -Body (@{serviceType='A'} | ConvertTo-Json) -ContentType 'application/json' -Headers @{ Origin='https://your-tunnel-id.devtunnels.ms' }
  Write-Host 'Ticket created:' ($ticket | ConvertTo-Json)
} catch {
  Write-Host 'Ticket creation error:' $_.Exception.Response.StatusDescription
}
