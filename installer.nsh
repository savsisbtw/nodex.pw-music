; nodex.music — custom NSIS installer skin
; Dark theme overrides for MUI2

!define MUI_BGCOLOR "060606"
!define MUI_TEXTCOLOR "e0e0e0"

; Remove unused pages — keep only progress
!define MUI_INSTFILESPAGE_PROGRESSBAR "smooth"

; Abort confirm suppressed for one-click
!define MUI_ABORTWARNING_CANCEL_DEFAULT

; Custom welcome/finish — hide them (one-click install)
!macro customInstall
  ; nothing extra
!macroend

!macro customUnInstall
  ; nothing extra
!macroend
