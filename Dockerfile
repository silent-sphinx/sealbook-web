# Base images are pinned by digest as well as by version, so a build is the one
# that was read. Raise the tag and the digest together when moving them; the
# digest is that of the tag's manifest list.
FROM rust:1.100.0-bookworm@sha256:ade39a710ef85f3506cffcfec3e8a24ba090badef1dff2fb798f71d878833fea AS wasm-builder

WORKDIR /workspace/sealbook
COPY sealbook/Cargo.toml sealbook/Cargo.lock ./
COPY sealbook/crates ./crates

RUN rustup target add wasm32-unknown-unknown \
		&& cargo install wasm-pack --version 0.15.1 --locked \
		&& mkdir -p /workspace/sealbook-web/src/pkg \
		&& wasm-pack build crates/sealbook-wasm \
			--target web \
			--release \
			--out-dir /workspace/sealbook-web/src/pkg

FROM node:24.22.3-bookworm@sha256:9d266751ca3d7fdbe651c878ffd5ad0a42fed49a18c283509267c97f025b7496 AS web-builder

WORKDIR /app
COPY sealbook-web/package.json sealbook-web/package-lock.json ./
RUN npm ci --ignore-scripts

COPY sealbook-web/ ./
COPY --from=wasm-builder /workspace/sealbook-web/src/pkg/ ./src/pkg/
RUN SKIP_WASM=1 npm run build \
		&& find dist -type f \
			\( -name '*.css' -o -name '*.html' -o -name '*.js' -o -name '*.json' \
				-o -name '*.svg' -o -name '*.wasm' -o -name '*.webmanifest' \) \
			-size +1k -exec gzip -9 -k {} +

# The stable line, which is the one that keeps receiving fixes.
FROM nginx:1.30.6-alpine@sha256:901e593c95dc85f5a729f5765516321366ef4ac401821431d408897e95287d0a AS runtime

COPY sealbook-web/nginx.conf /etc/nginx/conf.d/default.conf
COPY sealbook-web/security-headers.conf /etc/nginx/security-headers.conf
COPY --from=web-builder /app/dist/ /usr/share/nginx/html/

EXPOSE 80