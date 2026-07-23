# MELCloud Home

Control your Mitsubishi Electric air conditioners through the MELCloud Home
cloud.

## Requirements

- A **MELCloud Home** account (`melcloudhome.com`) — the new Mitsubishi Electric
  platform. If your account was created on the legacy MELCloud
  (`app.melcloud.com`), it will **not** work here: the two platforms are
  separate.
- Your air conditioners already added to your MELCloud Home account (via the
  MELCloud Home mobile app).

## Configuration

1. Enter the **email** and **password** of your MELCloud Home account. They are
   stored encrypted by Gladys and used only to authenticate against MELCloud
   Home.
2. Optionally adjust the **refresh interval** (how often the state is polled).
3. Save. Use **Test the connection** to confirm your credentials.

## Adding your air conditioners

Run a device discovery: every air-to-air unit on your account appears with four
features — **Power**, **Mode** (heat / cool / dry / fan / auto), **Target
temperature** and a read-only **Room temperature**. Create the ones you want to
control.

## Notes

- Only air-to-air units (air conditioners) are supported for now. Air-to-water
  heat pumps and ERV ventilation units are ignored.
- The connection status is shown on this screen; if it reports a login failure,
  re-check your email and password.
