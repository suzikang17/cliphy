/** The launchd job that keeps the helper running in the background from login. */
export function launchdPlist(opts: {
  node: string;
  main: string;
  cwd: string;
  logDir: string;
}): string {
  const log = `${opts.logDir}/helper.log`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>app.cliphy.helper</string>
  <key>ProgramArguments</key>
  <array>
    <string>${opts.node}</string>
    <string>--import</string>
    <string>tsx</string>
    <string>${opts.main}</string>
    <string>run</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${opts.cwd}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>StandardOutPath</key>
  <string>${log}</string>
  <key>StandardErrorPath</key>
  <string>${log}</string>
</dict>
</plist>
`;
}
