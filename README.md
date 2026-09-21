# Sealbook Web

Browser UI for the Sealbook vault.

![](Overview.png)

> [!IMPORTANT]
This ia a web client only. A working [sealbook](https://github.com/silent-sphinx/sealbook) server is required for operation.

## Running sealbook

An existing [sealbook](https://github.com/silent-sphinx/sealbook) server is required for operation, ensure you have setup sealbook server before continuing.

### 1. Clone sealbook-web

```
git clone https://github.com/silent-sphinx/sealbook-web.git
```

### 2. Install and run the NPM webserver

```bash
npm install
npm run wasm
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/v1` to the local server (self-signed TLS is handled by the proxy).

## Docker

Build the web image from the `sealbook-web` directory. The generated WASM
package must exist under `src/pkg`:

```bash
npm run wasm
docker build -f Dockerfile -t sealbook-web .
```

Run the web client:

```bash
docker compose up --build
```

Open `http://localhost:8080`.

