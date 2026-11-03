; Full Windows installer. Compiled by scripts/build-windows-installer.ps1.
#ifndef RepoRoot
  #error RepoRoot is required
#endif
#ifndef AppVersion
  #error AppVersion is required
#endif
#ifndef PrerequisiteDir
  #error PrerequisiteDir is required
#endif
#ifndef AppExe
  #define AppExe RepoRoot + "\src-tauri\target\release\netease-music-player.exe"
#endif
#ifndef Edition
  #define Edition "full"
#endif
#ifndef IncludeStudio
  #define IncludeStudio 1
#endif
#if Edition == "full"
  #define ProductLabel "Cove"
  #define InstallReadme RepoRoot + "\tools\installer\README.md"
#else
  #define ProductLabel "Cove Player"
  #define InstallReadme RepoRoot + "\tools\installer\README-player.md"
#endif

[Setup]
AppId={code:GetInstallerAppId}
AppName={#ProductLabel}
AppVersion={#AppVersion}
AppPublisher=Cove
UsePreviousLanguage=no
DefaultDirName={autopf}\{#ProductLabel}
DefaultGroupName={#ProductLabel}
DisableProgramGroupPage=yes
DisableDirPage=no
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=commandline
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputBaseFilename=Cove_{#AppVersion}-{#Edition}-setup
SetupIconFile={#RepoRoot}\src-tauri\icons\icon.ico
UninstallDisplayIcon={app}\netease-music-player.exe
Compression=lzma2/fast
LZMADictionarySize=1024
LZMANumBlockThreads=4
SolidCompression=yes
DiskSpanning=no
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
SetupLogging=yes

[Languages]
Name: "chinesesimplified"; MessagesFile: "{#PrerequisiteDir}\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "快捷方式："

[Files]
; Prerequisites are embedded and only executed when missing.
#if Edition == "full"
Source: "{#PrerequisiteDir}\MicrosoftEdgeWebView2RuntimeInstallerX64.exe"; Flags: dontcopy solidbreak
Source: "{#PrerequisiteDir}\vc_redist.x64.exe"; Flags: dontcopy
#endif
Source: "{#AppExe}"; DestDir: "{app}"; Flags: ignoreversion solidbreak
#if Edition == "full"
Source: "{#RepoRoot}\src-tauri\resources\ncm2acc\*"; DestDir: "{app}\resources\ncm2acc"; Excludes: ".gitignore,*.pyc,__pycache__\*"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#RepoRoot}\tools\ncm2acc\NOTICE.md"; DestDir: "{app}\resources\ncm2acc"; Flags: ignoreversion
Source: "{#RepoRoot}\docs\cover-studio-guide.md"; DestDir: "{app}\docs"; Flags: ignoreversion
#endif
Source: "{#InstallReadme}"; DestDir: "{app}"; DestName: "INSTALLATION.md"; Flags: ignoreversion

[Icons]
Name: "{code:GetStartMenuDirectory}\{#ProductLabel}"; Filename: "{app}\netease-music-player.exe"; WorkingDir: "{app}"; IconFilename: "{app}\netease-music-player.exe"
Name: "{code:GetDesktopDirectory}\{#ProductLabel}"; Filename: "{app}\netease-music-player.exe"; WorkingDir: "{app}"; IconFilename: "{app}\netease-music-player.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\netease-music-player.exe"; Description: "启动 Cove"; Flags: nowait postinstall skipifsilent runasoriginaluser

[Code]
#if Edition == "player"
var
  RuntimeDownloadPage: TDownloadWizardPage;

procedure InitializeWizard;
begin
  RuntimeDownloadPage := CreateDownloadPage('准备播放器运行环境', '只下载本机缺少的 Microsoft 运行环境', nil);
  RuntimeDownloadPage.ShowBaseNameInsteadOfUrl := True;
end;
#endif

function IsVerification: Boolean;
begin
  Result := ExpandConstant('{param:COVEVERIFY|0}') = '1';
end;

function GetInstallerAppId(Param: String): String;
begin
  if IsVerification then
    Result := 'Cove.{#Edition}.Installer.Verification'
  else
    Result := 'com.saymiao.netease-music-player.{#Edition}';
end;

function GetDesktopDirectory(Param: String): String;
begin
  if IsVerification then
    Result := ExpandConstant('{app}\verification-desktop')
  else
    Result := ExpandConstant('{autodesktop}');
end;

function GetStartMenuDirectory(Param: String): String;
begin
  if IsVerification then
    Result := ExpandConstant('{app}\verification-start-menu')
  else
    Result := ExpandConstant('{autoprograms}');
end;

function HasWebView2: Boolean;
var
  Version: String;
  Key: String;
begin
  Key := 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  Result := ((RegQueryStringValue(HKLM32, Key, 'pv', Version) or
              RegQueryStringValue(HKCU, Key, 'pv', Version)) and
              (Version <> '') and (Version <> '0.0.0.0'));
end;

function HasVCRuntime: Boolean;
var
  Installed: Cardinal;
begin
  Result := RegQueryDWordValue(HKLM32,
    'Software\Microsoft\VisualStudio\14.0\VC\Runtimes\x64',
    'Installed', Installed) and (Installed = 1);
end;

function InstallPrerequisite(Name, Arguments: String): String;
var
  ExitCode: Integer;
begin
  Result := '';
#if Edition == "full"
  ExtractTemporaryFile(Name);
#endif
  if not Exec(ExpandConstant('{tmp}\') + Name, Arguments, '',
              SW_HIDE, ewWaitUntilTerminated, ExitCode) then
    Result := '无法启动运行环境安装程序：' + Name
  else if (ExitCode <> 0) and (ExitCode <> 3010) then
    Result := '运行环境安装失败：' + Name + '，错误码 ' + IntToStr(ExitCode);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
#if Edition == "player"
  { Keep the player installer small. Both downloads use Microsoft's official HTTPS endpoints. }
  RuntimeDownloadPage.Clear;
  if not HasVCRuntime then
    RuntimeDownloadPage.Add('https://aka.ms/vs/17/release/vc_redist.x64.exe', 'vc_redist.x64.exe', '');
  if not HasWebView2 then
    RuntimeDownloadPage.Add('https://go.microsoft.com/fwlink/p/?LinkId=2124703', 'MicrosoftEdgeWebview2Setup.exe', '');
  if (not HasVCRuntime) or (not HasWebView2) then begin
    RuntimeDownloadPage.Show;
    try
      try
        RuntimeDownloadPage.Download;
      except
        Result := '运行环境下载失败，请联网后重试，或先安装 Microsoft WebView2 和 VC++ x64 运行环境：' + GetExceptionMessage;
      end;
    finally
      RuntimeDownloadPage.Hide;
    end;
    if Result <> '' then exit;
  end;
#endif
  if not HasVCRuntime then begin
    Result := InstallPrerequisite('vc_redist.x64.exe', '/install /quiet /norestart');
    if Result <> '' then exit;
  end;
  if not HasWebView2 then begin
#if Edition == "full"
    Result := InstallPrerequisite('MicrosoftEdgeWebView2RuntimeInstallerX64.exe', '/silent /install');
#else
    Result := InstallPrerequisite('MicrosoftEdgeWebview2Setup.exe', '/silent /install');
#endif
    if Result <> '' then exit;
    if not HasWebView2 then
      Result := 'WebView2 运行环境安装后未检测到，请重新运行安装程序。';
  end;
end;
