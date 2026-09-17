# Sealbook Web

Browser UI for the Sealbook contacts vault. Encryption, login proofs, and decryption run in WASM compiled from `sealbook-crypto`. The API only sees ciphertext.

## Run

The backend should already be listening on `https://127.0.0.1:8443`.

```bash
cd Sealbook-Web
npm install
npm run wasm
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/v1` to the local server (self-signed TLS is handled by the proxy).

## Sign-in

Creating an account shows 24 recovery words once. This browser keeps its own device keys in `localStorage`. After that, the page is a lock screen: enter the password to open the stored account.

**Sign in** on a browser that does not have those keys always pairs this browser with a signed-in device. Match the confirm code, then enter the password. Recovery words are still available from that page.

On a signed-in device, use **Add a device** to approve the pairing.
