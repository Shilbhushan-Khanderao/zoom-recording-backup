# NAS Mount for Local Copies (/mnt/shared)

Every downloaded recording is kept in the save folder after it is uploaded to Drive. If you
want the save folder on a Windows/SMB share, mount it like this (example values):

| | |
|---|---|
| Share | `//nas.example.local/share` |
| Mount point | `/mnt/shared` |
| Save folder | `/mnt/shared/zoom-backups` (`BACKUP_PATH` in `.env`, `savePath` in `config.json`) |
| Credentials | `$HOME/.smbcredentials` (mode 600, never commit) |

If the folder is missing or not writable, a backup fails immediately with
`Backup directory not writable (...)`; it does not fall back to another disk. The daily health
check also alerts when free space drops below `minFreeSpaceGB` (default 20 GB) or the path is
unavailable.

## Setup

### 1. Credentials file

```bash
cat > $HOME/.smbcredentials <<'EOF'
username=<windows-user>
password=<password>
domain=<DOMAIN>
EOF
chmod 600 $HOME/.smbcredentials
```

### 2. /etc/fstab entry

```bash
sudo cp /etc/fstab /etc/fstab.backup.$(date +%Y%m%d_%H%M%S)
echo '//nas.example.local/share /mnt/shared cifs credentials=$HOME/.smbcredentials,uid=1000,gid=1000,file_mode=0755,dir_mode=0755,vers=3.1.1,_netdev,nofail,x-systemd.automount 0 0' | sudo tee -a /etc/fstab
sudo systemctl daemon-reload
sudo mount -a
```

| Option | Why |
|---|---|
| `credentials=` | Keeps the password out of fstab |
| `uid=1000,gid=1000` | Files are owned by the user running PM2 |
| `vers=3.1.1` | SMB3 |
| `_netdev,nofail` | Wait for the network; boot even if the share is down |
| `x-systemd.automount` | Mount on first access instead of at boot |

Optional, on a slow network: add `x-systemd.requires=network-online.target,x-systemd.device-timeout=10`.

### 3. Verify

```bash
mountpoint /mnt/shared && df -h /mnt/shared
mkdir -p /mnt/shared/zoom-backups
touch /mnt/shared/zoom-backups/.write-test && rm /mnt/shared/zoom-backups/.write-test
node cli.js config-check
```

Check again after a reboot.

## Troubleshooting

```bash
ping nas.example.local                                            # network
smbclient -L //nas.example.local -A $HOME/.smbcredentials   # SMB login
sudo journalctl -u mnt-shared.mount -n 50                   # mount errors
sudo mount -v -t cifs //nas.example.local/share /mnt/shared \
  -o credentials=$HOME/.smbcredentials,uid=1000,gid=1000   # manual mount with details
```

- **"Resource temporarily unavailable" or a stale mount**: `sudo umount -l /mnt/shared && sudo mount /mnt/shared`.
- **Share down but backups must continue**: point `BACKUP_PATH` at a local folder with enough
  space (for example `$HOME/zoom-downloads`) and switch back later. Each backup reads the
  setting when it starts; restart `mail-bot` so its health check uses the new path. Drive
  uploads do not depend on the save folder.
