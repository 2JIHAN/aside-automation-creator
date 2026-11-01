#ifndef Architecture
  #error Architecture is required (x64 or arm64).
#endif
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
[Setup]
AppId=AsideAutomationCreator
AppName=Aside Automation Creator
AppVersion={#AppVersion}
AppPublisher=Aside Automation Creator contributors
CreateAppDir=no
Uninstallable=no
PrivilegesRequired=lowest
#if Architecture == "arm64"
ArchitecturesAllowed=arm64
ArchitecturesInstallIn64BitMode=arm64
#else
ArchitecturesAllowed=x64os
ArchitecturesInstallIn64BitMode=x64os
#endif
OutputDir={#OutputDir}
OutputBaseFilename=AsideAutomationCreator-{#AppVersion}-windows-{#Architecture}-Setup
SetupIconFile=icon.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
DisableProgramGroupPage=yes
DisableDirPage=yes
DisableWelcomePage=no
DisableReadyPage=no
CloseApplications=no
RestartApplications=no
SetupLogging=yes
[Files]
Source: "{#PayloadDir}\*"; DestDir: "{tmp}\aside-automation-creator-payload"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "bootstrap.ps1"; DestDir: "{tmp}"; Flags: ignoreversion
[Messages]
WelcomeLabel2=This installs the automation skill and bundled Node runtime for your Windows account. Aside must already be installed and opened once.%n%nIf needed, Setup downloads and verifies the official signed Aside CLI installer. Git and Node do not need to be installed.%n%nThis community Setup is unsigned. Windows SmartScreen may display a warning. Only continue if you trust the release you downloaded.
FinishedLabel=Installation finished. Open Aside to use aside-automation-creator. Your existing browser profiles and accounts have not been changed.
[Code]
procedure CurStepChanged(CurStep: TSetupStep);
var
  ExitCode: Integer;
  LogDir, ErrorText, Parameters: String;
  ErrorBytes: AnsiString;
begin
  if CurStep = ssPostInstall then
  begin
    WizardForm.StatusLabel.Caption := 'Installing dependencies and the automation skill...';
    WizardForm.ProgressGauge.Style := npbstMarquee;
    LogDir := ExpandConstant('{localappdata}\Aside\AutomationCreator\InstallerLogs\') + GetDateTimeString('yyyymmdd-hhnnss', '-', ':');
    ForceDirectories(LogDir);
    Parameters := '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -WindowStyle Hidden -File "' + ExpandConstant('{tmp}\bootstrap.ps1') + '" -PayloadDirectory "' + ExpandConstant('{tmp}\aside-automation-creator-payload') + '" -Architecture "{#Architecture}" -LogDirectory "' + LogDir + '"';
    if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Parameters, '', SW_HIDE, ewWaitUntilTerminated, ExitCode) then
      RaiseException('Could not start Windows PowerShell. ' + SysErrorMessage(ExitCode));
    if ExitCode <> 0 then
    begin
      ErrorText := 'Installation failed. No success is being reported.';
      if LoadStringFromFile(LogDir + '\error.txt', ErrorBytes) then
        ErrorText := UTF8Decode(ErrorBytes);
      RaiseException(ErrorText + #13#10 + 'Diagnostic logs: ' + LogDir);
    end;
    WizardForm.ProgressGauge.Style := npbstNormal;
    WizardForm.ProgressGauge.Position := WizardForm.ProgressGauge.Max;
  end;
end;
