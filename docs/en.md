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
2. Save. The connection status is shown right on this screen.

The state of your units is refreshed every minute; there is nothing else to
configure.

## Adding your devices

Your units are published as soon as the integration connects, so they are
already listed in the Discovery screen — run a scan to refresh the list.

- **Air-to-air units (air conditioners)** expose **Power**, **Mode** (heat /
  cool / dry / fan / auto), **Target temperature** and a read-only **Room
  temperature**, plus a **Fan speed** (auto, or only the speeds the unit
  actually has). Units fitted with vanes also get **Vertical swing** and
  **Horizontal swing** (auto, swing or a fixed position).
- **Air-to-water units (Ecodan heat pumps)** expose **Power**, a **Zone 1
  temperature** setpoint and read-only **Zone 1 room temperature**, an
  **Outdoor temperature** sensor, and — when a hot water tank is present —
  **Hot water temperature** (setpoint), a read-only **Hot water tank
  temperature** and a **Forced hot water** switch.

Create the ones you want to control.

## Remote control widget

On a dashboard, add the **Remote control** widget and pick an air conditioner.
It shows the room and target temperatures, the state (power, mode, fan speed,
swing) and four keys: **Turn on / Turn off**, **−** and **+** on the setpoint,
and a fourth key picked in the widget settings. Like the MODE key of a remote,
each tap moves the chosen setting (mode, fan speed, vertical or horizontal
swing) to its next value.

## Notes

- Air-to-air (air conditioners) and air-to-water (Ecodan heat pumps) units are
  supported. ERV ventilation units are ignored.
- Zone operation mode (heating curve, flow vs room thermostat) is not
  controllable yet on air-to-water units.
- The connection status is shown on this screen; if it reports a login failure,
  re-check your email and password.
