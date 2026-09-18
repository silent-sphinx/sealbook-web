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

## Sign-in & Setting Up a Device

Creating an account displays 24 recovery words once. Each browser/device generates and keeps its own cryptographic device keys in `localStorage`. Once enrolled, opening the app presents a lock screen: enter your password to unlock the stored vault. **Sign out** deletes those keys from that browser.

When opening Sealbook on a **new device or browser**, choose **Set up device**. You can set up the new device using either of two methods:

### Method 1: Pair with an Active Device (Recommended)
Use this method if you are already signed in on another computer, phone, or tablet:
1. On the new device, enter your username under **Pair with an active device** and click **Start pairing**.
2. On your signed-in device, click **Add device** in the top navigation bar.
3. Copy the pairing code from the new device and paste it into the **Add a new device** modal.
4. Verify that both screens show the exact same **Confirmation code**.
5. Click **Approve device** on your signed-in device.
6. Return to your new device, enter your password, and click **Finish device setup**.

### Method 2: Restore with 24 Recovery Words
Use this method if you do not have an active signed-in device available:
1. On the new device, select **Use 24 recovery words**.
2. Enter your username, paste or type your 24 secret recovery words, and enter your password.
3. Click **Restore vault on this device** to enroll the device and unlock your contacts.

