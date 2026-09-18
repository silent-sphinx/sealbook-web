# Sealbook Web

Browser UI for the Sealbook vault.

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

