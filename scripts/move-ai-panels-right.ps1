# Move Codex / Claude to Cursor right sidebar (secondary side bar).
# Run while Cursor is open. Then reload window: Ctrl+Shift+P -> Developer: Reload Window

$commands = @(
    'workbench.action.moveViewToSecondarySideBar',
    'workbench.view.extension.codexSecondaryViewContainer',
    'workbench.view.extension.claude-sidebar-secondary',
    'chatgpt.openSidebar'
)

foreach ($command in $commands) {
    $uri = "cursor://vscode/executecommand?command=$command"
    Start-Process $uri
    Start-Sleep -Milliseconds 500
}

Write-Host "Sent layout commands to Cursor. If panels are still on the left:"
Write-Host "1. Open Codex, right-click its title -> Move View to Secondary Side Bar"
Write-Host "2. Repeat for Claude Code"
Write-Host "3. Ctrl+Shift+P -> Developer: Reload Window"
