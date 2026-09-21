FROM rust:1-bookworm AS wasm-builder

WORKDIR /workspace/sealbook
COPY sealbook/Cargo.toml sealbook/Cargo.lock ./
COPY sealbook/crates ./crates

RUN rustup target add wasm32-unknown-unknown \
		&& cargo install wasm-pack --locked \
		&& mkdir -p /workspace/sealbook-web/src/pkg \
		&& wasm-pack build crates/sealbook-wasm \
			--target web \
			--release \
			--out-dir /workspace/sealbook-web/src/pkg

FROM node:22-bookworm AS web-builder

WORKDIR /app
COPY sealbook-web/package.json sealbook-web/package-lock.json ./
RUN npm ci

COPY sealbook-web/ ./
COPY --from=wasm-builder /workspace/sealbook-web/src/pkg/ ./src/pkg/
RUN SKIP_WASM=1 npm run build

FROM nginx:1.27-alpine AS runtime

COPY sealbook-web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-builder /app/dist/ /usr/share/nginx/html/

EXPOSE 80