# Switched from Nixpacks auto-detect to an explicit Dockerfile (2026-08-05)
# specifically to install poppler-utils reliably — two attempts via
# nixpacks.toml (nixPkgs, then aptPkgs) both deployed cleanly but a real
# functional test against production still hit "PDF conversion requires
# poppler-utils", with no setup-phase output visible in the build logs
# either way. A Dockerfile removes the ambiguity: this apt-get line is
# unambiguous and directly verifiable.
FROM node:22-bookworm-slim

# poppler-utils: pdftoppm / pdftotext (backend/src/utils/pdfFloorPlan.js) —
# Floor Plan's PDF-to-image conversion and booth auto-detection shell out
# to these. python3/make/g++: bcrypt compiles a native binary at install
# time — node-bookworm-slim doesn't include build tools by default, and
# without them an npm install that can't find a prebuilt binary for this
# exact image would fail outright rather than falling back gracefully.
RUN apt-get update && apt-get install -y --no-install-recommends \
      poppler-utils python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Root package.json only defines build/start scripts (no dependencies of
# its own) — copied first so this layer only invalidates when the actual
# per-package manifests change, not on every source edit.
COPY package.json ./
COPY frontend/package*.json frontend/
COPY backend/package*.json backend/

COPY . .

RUN npm run build

ENV NODE_ENV=production
EXPOSE 3001

CMD ["npm", "start"]
