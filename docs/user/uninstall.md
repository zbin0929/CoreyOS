# Uninstall Guide — CoreyOS

## macOS

### 1. Quit the app
- Right-click the dock icon → Quit, or press `⌘Q`.

### 2. Delete the application
```bash
rm -rf /Applications/CoreyOS.app
```

### 3. Remove Hermes data (optional — contains skills, chat history, .env)
```bash
rm -rf ~/.hermes
```

### 4. Remove Corey's own config & database
```bash
rm -rf ~/Library/Application\ Support/com.caduceus.app
```

### 5. Remove license file (optional)
```bash
rm -f ~/.hermes/license.txt
```

### 6. Remove Pack state (optional)
```bash
rm -rf ~/.hermes/skill-packs
rm -f ~/.hermes/pack-state.json
```

> **In-app alternative**: Settings → Storage → Danger Zone provides
> "Clear Hermes data" and "Reset Corey config" buttons that perform
> steps 3 and 4 respectively without deleting the app binary.

---

## Windows

### 1. Quit the app
- Close the window or right-click the taskbar icon → Exit.

### 2. Uninstall via Settings
- Settings → Apps → Installed apps → CoreyOS → Uninstall

### 3. Remove Hermes data (optional)
```powershell
Remove-Item -Recurse -Force "$env:USERPROFILE\.hermes"
```

### 4. Remove Corey's own config & database
```powershell
Remove-Item -Recurse -Force "$env:APPDATA\com.caduceus.app"
```

### 5. Remove license file (optional)
```powershell
Remove-Item -Force "$env:USERPROFILE\.hermes\license.txt"
```

### 6. Remove Pack state (optional)
```powershell
Remove-Item -Recurse -Force "$env:USERPROFILE\.hermes\skill-packs"
Remove-Item -Force "$env:USERPROFILE\.hermes\pack-state.json"
```

> **In-app alternative**: Settings → Storage → Danger Zone provides
> "Clear Hermes data" and "Reset Corey config" buttons that perform
> steps 3 and 4 respectively without uninstalling the app.

---

## What each reset preserves

| Action | Skills | Chat DB | .env | License | Packs | Gateway config |
|--------|--------|---------|------|---------|-------|----------------|
| Clear Hermes data | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Reset Corey config | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ |
| Full uninstall | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
