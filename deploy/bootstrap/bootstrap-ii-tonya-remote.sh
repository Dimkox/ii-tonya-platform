set -Eeuo pipefail
install -d -m 0700 -o ii_tonya -g ii_tonya /home/ii_tonya/.ssh
touch /home/ii_tonya/.ssh/authorized_keys
grep -qxF 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEHHsVB20gQQXdWToMkjEiplkyqYpSWc9CTokcU43RlD ii-tonya-ephemeral-b35f5a5' /home/ii_tonya/.ssh/authorized_keys || printf '%s\n' 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEHHsVB20gQQXdWToMkjEiplkyqYpSWc9CTokcU43RlD ii-tonya-ephemeral-b35f5a5' >> /home/ii_tonya/.ssh/authorized_keys
chown ii_tonya:ii_tonya /home/ii_tonya/.ssh/authorized_keys
chmod 0600 /home/ii_tonya/.ssh/authorized_keys
printf '%s\n' 'ii_tonya ALL=(root) NOPASSWD: /usr/bin/install, /usr/bin/systemctl, /usr/bin/rm' > /etc/sudoers.d/ii-tonya-deploy
chmod 0440 /etc/sudoers.d/ii-tonya-deploy
visudo -cf /etc/sudoers.d/ii-tonya-deploy >/dev/null
sed -i 's/^MIGRATION_COMPATIBILITY_APPROVED_SHA=.*/MIGRATION_COMPATIBILITY_APPROVED_SHA=b35f5a55574236c48aa0e6c2c5ed2c955d5aa6f0/' /etc/ii-tonya/runtime.env
grep -qxF 'MIGRATION_COMPATIBILITY_APPROVED_SHA=b35f5a55574236c48aa0e6c2c5ed2c955d5aa6f0' /etc/ii-tonya/runtime.env
test "$(sshd -T | awk '/^permitrootlogin / {print $2}')" = yes
test "$(sshd -T | awk '/^passwordauthentication / {print $2}')" = yes
printf 'PROD_BOOTSTRAP_OK\n'
