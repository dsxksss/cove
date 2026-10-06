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

[Setup]
AppId={code:GetInstallerAppId}
AppName=Cove
AppVersion={#AppVersion}
AppPublisher=Cove
UsePreviousLanguage=no
DefaultDirName={autopf}\Cove
DefaultGroupName=Cove
DisableProgramGroupPage=yes
DisableDirPage=no
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=commandline
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputBaseFilename=Cove_{#AppVersion}-full-setup
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
Source: "{#PrerequisiteDir}\MicrosoftEdgeWebView2RuntimeInstallerX64.exe"; Flags: dontcopy solidbreak
Source: "{#PrerequisiteDir}\vc_redist.x64.exe"; Flags: dontcopy
Source: "{#RepoRoot}\src-tauri\target\release\netease-music-player.exe"; DestDir: "{app}"; Flags: ignoreversion solidbreak
Source: "{#RepoRoot}\src-tauri\resources\ncm2acc\*"; DestDir: "{app}\resources\ncm2acc"; Excludes: ".gitignore,*.pyc,__pycache__\*"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#RepoRoot}\tools\installer\README.md"; DestDir: "{app}"; DestName: "INSTALLATION.md"; Flags: ignoreversion
Source: "{#RepoRoot}\tools\ncm2acc\NOTICE.md"; DestDir: "{app}\resources\ncm2acc"; Flags: ignoreversion

[Icons]
Name: "{code:GetStartMenuDirectory}\Cove"; Filename: "{app}\netease-music-player.exe"; WorkingDir: "{app}"; IconFilename: "{app}\netease-music-player.exe"
Name: "{code:GetDesktopDirectory}\Cove"; Filename: "{app}\netease-music-player.exe"; WorkingDir: "{app}"; IconFilename: "{app}\netease-music-player.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\netease-music-player.exe"; Description: "启动 Cove"; Flags: nowait postinstall skipifsilent runasoriginaluser

[Code]
function IsVerification: Boolean;
begin
  Result := ExpandConstant('{param:COVEVERIFY|0}') = '1';
end;

function GetInstallerAppId(Param: String): String;
begin
  if IsVerification then
    Result := 'Cove.FullInstaller.Verification'
  else
    Result := 'com.saymiao.netease-music-player.full';
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
  ExtractTemporaryFile(Name);
  if not Exec(ExpandConstant('{tmp}\') + Name, Arguments, '',
              SW_HIDE, ewWaitUntilTerminated, ExitCode) then
    Result := '无法启动运行环境安装程序：' + Name
  else if (ExitCode <> 0) and (ExitCode <> 3010) then
    Result := '运行环境安装失败：' + Name + '，错误码 ' + IntToStr(ExitCode);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if not HasVCRuntime then begin
    Result := InstallPrerequisite('vc_redist.x64.exe', '/install /quiet /norestart');
    if Result <> '' then exit;
  end;
  if not HasWebView2 then begin
    Result := InstallPrerequisite('MicrosoftEdgeWebView2RuntimeInstallerX64.exe', '/silent /install');
    if Result <> '' then exit;
    if not HasWebView2 then
      Result := 'WebView2 运行环境安装后未检测到，请重新运行安装程序。';
  end;
end;
