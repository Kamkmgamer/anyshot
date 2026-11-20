; anyshot in Explorer's "Open with" for images, without taking over their default app.
; electron-builder's fileAssociations would make anyshot the default for each type,
; so the keys are written here: a ProgID, the types' OpenWithProgids, and the
; Applications entry. SHCTX is HKCU for the per-user install.

!define ANYSHOT_PROGID "anyshot.Image"
!define ANYSHOT_APP_KEY "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}"

!macro anyshotOpenWith EXT
  WriteRegStr SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "${ANYSHOT_PROGID}" ""
  WriteRegStr SHCTX "${ANYSHOT_APP_KEY}\SupportedTypes" ".${EXT}" ""
!macroend

!macro anyshotRemoveOpenWith EXT
  DeleteRegValue SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "${ANYSHOT_PROGID}"
!macroend

!macro customInstall
  WriteRegStr SHCTX "Software\Classes\${ANYSHOT_PROGID}" "" "Image"
  WriteRegStr SHCTX "Software\Classes\${ANYSHOT_PROGID}\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHCTX "Software\Classes\${ANYSHOT_PROGID}\shell\open" "FriendlyAppName" "anyshot"
  WriteRegStr SHCTX "Software\Classes\${ANYSHOT_PROGID}\shell\open\command" "" '"$appExe" "%1"'
  WriteRegStr SHCTX "${ANYSHOT_APP_KEY}" "FriendlyAppName" "anyshot"
  WriteRegStr SHCTX "${ANYSHOT_APP_KEY}\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHCTX "${ANYSHOT_APP_KEY}\shell\open\command" "" '"$appExe" "%1"'
  !insertmacro anyshotOpenWith "png"
  !insertmacro anyshotOpenWith "jpg"
  !insertmacro anyshotOpenWith "jpeg"
  !insertmacro anyshotOpenWith "webp"
  !insertmacro anyshotOpenWith "gif"
  !insertmacro anyshotOpenWith "bmp"
  !insertmacro anyshotOpenWith "anyshot"
  ; Tell Explorer the associations changed (SHCNE_ASSOCCHANGED).
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  !insertmacro anyshotRemoveOpenWith "png"
  !insertmacro anyshotRemoveOpenWith "jpg"
  !insertmacro anyshotRemoveOpenWith "jpeg"
  !insertmacro anyshotRemoveOpenWith "webp"
  !insertmacro anyshotRemoveOpenWith "gif"
  !insertmacro anyshotRemoveOpenWith "bmp"
  !insertmacro anyshotRemoveOpenWith "anyshot"
  DeleteRegKey SHCTX "Software\Classes\${ANYSHOT_PROGID}"
  DeleteRegKey SHCTX "${ANYSHOT_APP_KEY}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
