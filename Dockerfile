FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    # Rust toolchain
    RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:/usr/local/go/bin:$PATH

# ── System packages ──────────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Core utilities
    curl wget git unzip zip ca-certificates gnupg lsb-release sudo \
    # Build tools
    build-essential gcc g++ make cmake \
    # SSH for remote access
    openssh-server \
    # psql client (used in entrypoint to apply migrate.sql)
    postgresql-client \
    # Debug / admin tools
    vim nano less htop jq procps net-tools iputils-ping \
    # Python (ORT uses python-inspector for Python project analysis)
    python3 python3-pip python3-venv python-is-python3 \
    # Java 17 (required by ORT)
    openjdk-17-jdk \
    # Maven + Gradle (Java/Kotlin build systems)
    maven gradle \
    # Ruby + full dev headers (for Bundler)
    ruby-full ruby-dev \
    # PHP + Composer dependencies
    php php-cli php-mbstring php-xml php-curl php-zip \
    # Elixir + Erlang (for Mix/Hex)
    erlang elixir \
    && rm -rf /var/lib/apt/lists/*

# ── Node.js 20 ───────────────────────────────────────────────────────────────
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g yarn \
    && rm -rf /var/lib/apt/lists/*

# ── SBT (Scala build tool) ───────────────────────────────────────────────────
RUN curl -fsSL "https://keyserver.ubuntu.com/pks/lookup?op=get&search=0x2EE0EA64E40A89B84B2DF73499E82A75642AC823" \
      | gpg --dearmor -o /etc/apt/trusted.gpg.d/scalasbt.gpg \
    && echo "deb https://repo.scala-sbt.org/scalasbt/debian all main" \
      > /etc/apt/sources.list.d/sbt.list \
    && apt-get update && apt-get install -y sbt \
    && rm -rf /var/lib/apt/lists/*

# ── Go 1.22 ──────────────────────────────────────────────────────────────────
RUN curl -fsSL https://go.dev/dl/go1.22.4.linux-amd64.tar.gz \
      | tar -C /usr/local -xzf -

# ── Rust (stable) ────────────────────────────────────────────────────────────
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
      | sh -s -- -y --no-modify-path --default-toolchain stable \
    && chmod -R a+w /usr/local/rustup /usr/local/cargo

# ── PHP Composer ─────────────────────────────────────────────────────────────
RUN curl -fsSL https://getcomposer.org/installer \
      | php -- --install-dir=/usr/local/bin --filename=composer

# ── Ruby Bundler ─────────────────────────────────────────────────────────────
RUN gem install bundler

# ── Python inspector (ORT uses this for Python dependency resolution) ─────────
RUN pip3 install python-inspector

# ── ORT v83 ──────────────────────────────────────────────────────────────────
RUN mkdir -p /opt/tools/ort \
    && curl -fsSL "https://github.com/oss-review-toolkit/ort/releases/download/83.0.0/ort-83.0.0.zip" \
         -o /tmp/ort.zip \
    && unzip -q /tmp/ort.zip -d /opt/tools/ort \
    && rm /tmp/ort.zip \
    && chmod +x /opt/tools/ort/ort-83.0.0/bin/ort

# ── enry v1.2.0 (Linux amd64) ────────────────────────────────────────────────
RUN mkdir -p /opt/tools/enry \
    && curl -fsSL "https://github.com/go-enry/enry/releases/download/v1.2.0/enry-v1.2.0-linux-amd64.tar.gz" \
         | tar -xz -C /opt/tools/enry \
    && chmod +x /opt/tools/enry/enry

# ── SSH server ───────────────────────────────────────────────────────────────
RUN mkdir /var/run/sshd \
    && sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config \
    && sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config \
    && echo 'root:pika' | chpasswd

# Non-root dev user
RUN useradd -m -s /bin/bash pika \
    && echo 'pika:pika' | chpasswd \
    && echo 'pika ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers

# ── Application ──────────────────────────────────────────────────────────────
WORKDIR /app

# Install dependencies in a cacheable layer (before copying source)
COPY package*.json ./
COPY server/package*.json ./server/
COPY client/package*.json ./client/
COPY shared/package*.json ./shared/
RUN npm install

# Copy source
COPY . .

# Symlink pre-downloaded tools into the app's expected location
RUN ln -sf /opt/tools /app/tools

# Build shared package (server and client both depend on it)
RUN npm run build --workspace=shared

# ── Ports ─────────────────────────────────────────────────────────────────────
# 22   — SSH
# 3000 — Express API
# 5173 — Vite dev server
EXPOSE 22 3000 5173

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]
