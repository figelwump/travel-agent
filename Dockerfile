# Build and run the Claude sandbox server with Bun
FROM oven/bun:1.2.23

# Install cron and OpenSSH server so Render SSH can connect
RUN apt-get update \
  && apt-get install -y --no-install-recommends cron openssh-server \
  && rm -rf /var/lib/apt/lists/*

# Prepare sshd requirements and lock down SSH to key-only auth
RUN mkdir -p /var/run/sshd /root/.ssh \
  && chmod 700 /root/.ssh \
  && sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config \
  && sed -i 's/^#\?PermitRootLogin .*/PermitRootLogin without-password/' /etc/ssh/sshd_config \
  && passwd -u root || true

# Entrypoint starts cron then runs the app
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

WORKDIR /app

# Install dependencies first for better layer caching
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy the rest of the repo
COPY . .

ENV PORT=3000
EXPOSE 3000 22

ENTRYPOINT ["entrypoint.sh"]
CMD ["bun", "run", "server/server.ts"]
