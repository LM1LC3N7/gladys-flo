# Flo by Moen

This integration brings the **Flo by Moen Smart Water Shutoff** and the **Flo
Water Sensors** into Gladys, through the Flo cloud the Moen Smartwater app
(formerly Flo) uses, with the e-mail and password of your account. These
products are sold in the United States and Canada. Unofficial, not affiliated
with Moen or Fortune Brands.

> **Development version (0.1).** Written from the Python library `aioflo`
> (the one of the Home Assistant Flo integration). The integration has **never
> been tested on a real device or a real account**: only against simulated
> answers. Feedback is welcome on the GitHub repository.

## What you get

| Flo device                  | In Gladys                                                                                                                                                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Smart Water Shutoff (valve) | buttons **Shut the water off** and **Turn the water on**, valve open (0/1, read only), away mode (settable, see "Safety"), mode (text: home, away, sleep), flow m³/h, pressure psi, water temperature °C, today's use in litres, leak alert, pending alerts (text) |
| Water Sensor (leak sensor)  | water leak, temperature °C, humidity %, battery %                                                                                                                                                                                                                  |

Other Flo devices (bridge…) are skipped: the **Test the connection** button
counts them.

Units: the flow is converted from gallons per minute to m³/h, the use from
gallons to litres, temperatures from °F to °C (Gladys shows them as you
prefer). The pressure stays in psi. A shutoff without a water temperature
probe sends a placeholder (225 °F): it is ignored.

## Installation

1. Install the integration from the Gladys store.
2. In the **Configuration** tab, enter the e-mail and password of your Flo or
   Moen Smartwater account, then save. The status reads "Connected to Flo: 2
   devices."
3. Open the **Discovery** tab and add the devices you want. Their values
   arrive as soon as they are added.

**Sign-in**: "Automatic" (default) tries the historical Flo sign-in, then the
Moen one (newer Moen Smartwater accounts) when Flo refuses or no longer
answers there. Once Flo refused, only Moen is tried until the configuration
changes. You can force either.

## Safety: closing always allowed, the rest off by default

**Closing the valve shuts the water off: it protects, so it is never refused
and needs no option.** A shutoff (the **Shut the water off** button, the scene
action "close", or the valve switch of a device added before 0.1.3 set to 0):

- leaves at once, without waiting for another command of the valve, even
  during a pause Flo asked for (one request; a second click within a minute
  waits for the end of the pause); an opening still waiting its turn is
  cancelled;
- is **kept until Flo shows the valve closed** by a reading made after it was
  sent (device online). Until then it is sent again: the valve is read again
  90 seconds after each send and the shutoff sent again if it is not closed,
  3 times, then every 15 minutes; also after a restart of the integration
  (it is kept in its data) and when Flo answers again after an outage; a send
  that failed is tried again after 15 seconds. The resends wait for the pause
  Flo asks for (too many requests) and for new credentials when Flo refuses
  them;
- is **given up 24 hours after it first left** without Flo showing the valve
  closed, said in the integration status; also when the device is deleted
  in Gladys or Flo no longer knows it (two answers in a row);
- once seen closed, or once Flo shows an opening asked after it (the Moen
  app), it is done: reopening the water elsewhere is never fought.

If the shutoff could not reach Flo within the time Gladys waits (3.5 seconds
from the dashboard), Gladys shows a message saying that it is kept and sent
again. A scene action "close" never fails because of that: its "Command sent"
output is then false.

These commands are refused until you allow them in the configuration:

| Option                            | Default | Off: Gladys…               |
| --------------------------------- | ------- | -------------------------- |
| Allow opening the valve           | no      | never turns the water on   |
| Allow changing the Home/Away mode | no      | never changes the Flo mode |

Even allowed, an opening:

- runs **one at a time** for a device;
- reads the device from Flo **just before acting**: if that read fails, the
  device is offline, or the valve is moving or in an unknown state, the
  opening is **refused**; the state kept in memory never decides;
- is refused within 20 seconds of a shutoff of the same valve still waiting
  to be seen closed, and cancelled when a shutoff is asked while it waits
  its turn;
- sends nothing when the valve is already open, or already opening;
- is **refused rather than sent late** when it could not leave in time (3.5
  seconds after the request from the dashboard, 25 seconds for a scene
  action): Gladys would already have shown a failure;
- lets go of a shutoff of the same valve asked before it (the opening is
  what you asked last);
- reads the device again 15 seconds and 60 seconds later (even after a
  failure), to show the real position.

**The water commands are buttons**, never a switch: a voice assistant, a
"turn everything off" command or a scene acting on every switch never
reaches them. Since 0.1.3 the valve switch is no longer offered in
Discovery; on a device added before, it still works (a scene "leak → valve
to 0" keeps protecting) but it can be reached by a "turn everything off".
**What to do**: in your scenes, replace the valve switch with the **Shut the
water off** button (or the scene action "Flo: open or close the valve"),
then run Discovery again and save the device so that the switch goes away.

**Home / Away mode** (the "Away mode" switch or a scene action): off by
default. **Switching to Home disarms the automatic shutoff Flo applies in
Away**: turn the option on knowingly. **Sleep** needs a duration: it is shown,
but set in the Moen app. A mode Flo has locked is refused.

## Scenes

Triggers:

- **Flo: leak detected**: a Water Sensor detects water, or Flo raises a new
  **critical or warning** leak alert (water detected, drip, failed health
  test); filtered by severity;
- **Flo: abnormal flow**: a new critical or warning fast flow, long flow or
  high use alert;
- **Flo: new alert**: any new alert, filtered by severity and family.

A trigger fires once per new alert, at the refresh that finds it (an alert
still pending does not fire again). What the integration saw last is kept in
`/data`: an alert raised during a restart fires at the next start. The alerts
of a device never seen before do not fire (nothing says they are new).

The family of an alert (leak, flow, other) comes from its name in the Flo
alarm catalog, read once a day, matched against a list of known names. **When
the catalog is unavailable** (or an alert is not in it), the alert is
"other": only "new alert" fires, and, by caution, an unknown critical alert
turns "Leak alert" on. The "Pending alerts" feature always lists every alert.

**Recommended to shut the water off**: besides "leak detected", make a scene
on the **"device state changed"** trigger of the **Water leak** feature of the
Water Sensor (or **Leak alert** of the shutoff) going to 1. That state is read
again at every refresh, even if a scene event was missed.

Actions: **Flo: set Home or Away** (one home or all) and **Flo: open or close
the valve**: closing is never refused, the others are behind the options
above.

## Usage limits

- Flo publishes no API limit. The integration reads the account and each
  device every 2 minutes by default (1 to 60), today's use every 15 minutes
  and the alarm catalog once a day: Home Assistant's pace (1 minute) or
  slower.
- When Flo answers "too many requests" (429), the integration pauses for the
  time asked (1 minute to 1 hour, 5 minutes when not given). After a network
  error or a Flo outage it tries again after 1, 2, 5, 10 then 15 minutes.
- A refused e-mail or password is never retried by itself: the integration
  waits for a change or a click on **Test the connection**.
- Values arrive at the refresh pace, not in real time.
- Gladys accepts 300 states a minute: only the values that change are sent
  (and every value at least every 30 minutes).

## Options

| Option                            | Default   | Role                                       |
| --------------------------------- | --------- | ------------------------------------------ |
| E-mail, password                  | —         | your Flo / Moen Smartwater account         |
| Allow opening the valve           | no        | see "Safety"                               |
| Allow changing the Home/Away mode | no        | see "Safety"                               |
| Sign-in                           | Automatic | Flo then Moen, or either one               |
| Refresh interval (min)            | 2         | how often the devices are read             |
| Language of the feature names     | French    | names of the features of the devices added |

## Troubleshooting

- **"Flo refused the e-mail or the password"**: check them in the Moen
  Smartwater app. Try the "Moen" sign-in if your account was made in the Moen
  app.
- **"Flo cannot be reached"**: a Flo outage or your connection; the
  integration tries again by itself.
- **`unreachable` badge with an orange dot**: Flo reports the device offline
  (Wi-Fi, sensor batteries).
- **"The state of the Flo valve could not be confirmed"**: the valve was
  offline, moving or unreadable when the command came; try again later.
- **"The command waited too long for its turn"**: Flo answered slowly; try
  again.

## Privacy

The e-mail and password are **kept by Gladys in its database** (and so in its
backups); the password is never shown again in the interface. They are only
sent to the Flo sign-in (`api.meetflo.com`) and the Moen one (Amazon Cognito,
`execute-api.us-east-2.amazonaws.com`), over HTTPS. The token stays in memory
and never reaches a log. The only file written to `/data` (`flo-seen.json`)
holds the alert counts and the "water detected" state of each device, no
secret.

Flo by Moen and Moen are trademarks of Moen Incorporated (Fortune Brands); this
integration is not affiliated with Moen.
