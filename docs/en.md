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

| Flo device                  | In Gladys                                                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Smart Water Shutoff (valve) | valve open/closed (settable, see "Safety"), away mode (settable), mode (text: home, away, sleep), flow m³/h, pressure psi, water temperature °C, today's use in litres, leak or flow alert |
| Water Sensor (leak sensor)  | water leak, temperature °C, humidity %, battery %                                                                                                                                          |

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
answers there. You can force either.

## Safety: the valve is off by default

Opening **and** closing the valve from Gladys are refused until you allow them
in the configuration:

| Option                  | Default | Off: Gladys…              |
| ----------------------- | ------- | ------------------------- |
| Allow closing the valve | no      | never shuts the water off |
| Allow opening the valve | no      | never turns the water on  |

To shut the water off from a scene when a leak is detected, turn on "Allow
closing the valve". Even allowed, a valve command:

- runs **one at a time** for a device (two "close" at once are never sent
  together);
- reads the device from Flo **just before acting**: if that read fails, the
  device is offline, or the valve is moving or in an unknown state, the
  command is **refused**; the state kept in memory never decides;
- sends nothing when the valve is already where asked;
- reads the device again 15 seconds and 60 seconds later, to show the real
  position.

The **Home / Away** mode can always be changed (the "Away mode" switch or a
scene action). **Sleep** needs a duration: it is shown, but set in the Moen
app. A mode Flo has locked is refused.

## Scenes

Triggers:

- **Flo: leak detected**: a Water Sensor detects water, or Flo raises a new
  leak alert (drip, failed health test);
- **Flo: abnormal flow**: a new fast flow, long flow or high use alert;
- **Flo: new alert**: any new alert, filtered by severity and family.

A trigger fires once per new alert (an alert still pending does not fire
again, nor do the ones already pending at start). The family of an alert
comes from its name in the Flo alarm catalog, read once a day; without the
catalog, only critical alerts turn "Leak or flow alert" on.

Actions: **Flo: set Home or Away** (one home or all) and **Flo: open or close
the valve** (behind the options above).

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

| Option                        | Default   | Role                                       |
| ----------------------------- | --------- | ------------------------------------------ |
| E-mail, password              | —         | your Flo / Moen Smartwater account         |
| Allow closing the valve       | no        | see "Safety"                               |
| Allow opening the valve       | no        | see "Safety"                               |
| Sign-in                       | Automatic | Flo then Moen, or either one               |
| Refresh interval (min)        | 2         | how often the devices are read             |
| Language of the feature names | French    | names of the features of the devices added |

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

## Privacy

The e-mail and password are stored by Gladys (the password as a secret, never
sent back to the browser). They are only sent to the Flo sign-in
(`api.meetflo.com`) and the Moen one (Amazon Cognito,
`execute-api.us-east-2.amazonaws.com`), over HTTPS. The token stays in memory
(nothing is written to `/data`) and never reaches a log.

Flo by Moen and Moen are trademarks of Moen Incorporated (Fortune Brands); this
integration is not affiliated with Moen.
