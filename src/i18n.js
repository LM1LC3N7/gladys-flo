// -----------------------------------------------------------------------------
// Texts shown in Gladys (connection status, buttons, device and feature
// names, command refusals), in English and French.
// -----------------------------------------------------------------------------

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The text of `texts` in `language`, English otherwise. */
export const word = (texts, language) => texts?.[language] ?? texts?.en ?? '';

/** Device names when Flo gives none. */
export const TYPE_NAMES = {
  shutoff: { en: 'Flo Smart Water Shutoff', fr: "Vanne d'arrêt Flo" },
  sensor: { en: 'Flo Water Sensor', fr: 'Détecteur de fuite Flo' },
};

/** Feature names, in the language chosen in the configuration. */
export const FEATURE_NAMES = {
  valve: { en: 'Valve open', fr: 'Vanne ouverte' },
  away: { en: 'Away mode', fr: 'Mode absent' },
  mode: { en: 'Mode', fr: 'Mode' },
  flow: { en: 'Flow rate', fr: 'Débit' },
  pressure: { en: 'Water pressure', fr: "Pression de l'eau" },
  water_temperature: { en: 'Water temperature', fr: "Température de l'eau" },
  consumption_today: { en: 'Consumption today', fr: "Consommation aujourd'hui" },
  leak_alert: { en: 'Leak alert', fr: 'Alerte fuite' },
  alerts: { en: 'Pending alerts', fr: 'Alertes en attente' },
  leak: { en: 'Water leak', fr: "Fuite d'eau" },
  temperature: { en: 'Temperature', fr: 'Température' },
  humidity: { en: 'Humidity', fr: 'Humidité' },
  battery: { en: 'Battery', fr: 'Batterie' },
};

/** "25 min" / "3 h", for the pauses. */
export function age(ms) {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 120) {
    return { en: `${minutes} min`, fr: `${minutes} min` };
  }
  const hours = Math.round(minutes / 60);
  return { en: `${hours} h`, fr: `${hours} h` };
}

export const T = {
  noCredentials: {
    en: 'Enter the e-mail and the password of your Flo by Moen account (the ones of the Moen Smartwater or Flo app).',
    fr: "Saisissez l'e-mail et le mot de passe de votre compte Flo by Moen (ceux de l'application Moen Smartwater ou Flo).",
  },
  connecting: {
    en: 'Connecting to Flo…',
    fr: 'Connexion à Flo…',
  },
  connected: (devices, skipped) => ({
    en: `Connected to Flo: ${plural(devices, 'device', 'devices')}${skipped ? ` (${plural(skipped, 'other', 'others')} not supported)` : ''}. Open Discovery to add them.`,
    fr: `Connecté à Flo : ${plural(devices, 'appareil', 'appareils')}${skipped ? ` (${plural(skipped, 'autre non pris en charge', 'autres non pris en charge')})` : ''}. Ouvrez Découverte pour les ajouter.`,
  }),
  refused: {
    en: 'Flo refused the e-mail or the password: check them in the configuration (the integration waits for a change or the test button).',
    fr: "Flo a refusé l'e-mail ou le mot de passe : vérifiez-les dans la configuration (l'intégration attend une modification ou le bouton de test).",
  },
  unreachable: (reason, wait) => ({
    en: `Flo cannot be reached (${reason}). Next try in ${wait.en}.`,
    fr: `Flo est injoignable (${reason}). Nouvel essai dans ${wait.fr}.`,
  }),
  rateLimited: (wait) => ({
    en: `Flo asks to slow down: pausing for ${wait.en}.`,
    fr: `Flo demande de ralentir : pause de ${wait.fr}.`,
  }),
  offline: {
    en: 'Flo reports this device offline.',
    fr: 'Flo signale cet appareil hors ligne.',
  },
  forbidden: {
    en: 'Flo refused to read this device: asked again within an hour (or with the test button).',
    fr: "Flo a refusé la lecture de cet appareil : nouvel essai dans l'heure (ou avec le bouton de test).",
  },
  noAlert: { en: 'none', fr: 'aucune' },
  denied: {
    modeOff: {
      en: 'Changing the Flo mode (Home/Away) from Gladys is turned off: allow it in the configuration of the Flo integration.',
      fr: "Le changement de mode Flo (Maison/Absent) depuis Gladys est désactivé : autorisez-le dans la configuration de l'intégration Flo.",
    },
    tooLate: {
      en: 'The command waited too long for its turn: refused rather than sent late. Try again.',
      fr: 'La commande a attendu trop longtemps son tour : refusée plutôt qu’envoyée en retard. Réessayez.',
    },
    noValve: {
      en: 'This Flo device has no valve.',
      fr: "Cet appareil Flo n'a pas de vanne.",
    },
    notCommand: {
      en: 'This Flo feature cannot be set.',
      fr: 'Cette fonctionnalité Flo ne peut pas être commandée.',
    },
    badValue: {
      en: 'Unexpected value: 0 or 1.',
      fr: 'Valeur inattendue : 0 ou 1.',
    },
    pickShutoff: {
      en: 'Pick a Flo Smart Water Shutoff.',
      fr: "Choisissez une vanne d'arrêt Flo.",
    },
    badAction: {
      en: 'The action is "open" or "close".',
      fr: "L'action est « open » ou « close ».",
    },
    unknownDevice: {
      en: 'Unknown Flo device.',
      fr: 'Appareil Flo inconnu.',
    },
    valveOpen: {
      en: 'Opening the Flo valve from Gladys is turned off: allow it in the configuration of the Flo integration.',
      fr: "L'ouverture de la vanne Flo depuis Gladys est désactivée : autorisez-la dans la configuration de l'intégration Flo.",
    },
    valveClose: {
      en: 'Closing the Flo valve from Gladys is turned off: allow it in the configuration of the Flo integration.',
      fr: "La fermeture de la vanne Flo depuis Gladys est désactivée : autorisez-la dans la configuration de l'intégration Flo.",
    },
    valveUnknown: {
      en: 'The state of the Flo valve could not be confirmed just now (offline, moving, unknown or not read): the command is refused.',
      fr: "L'état de la vanne Flo n'a pas pu être confirmé à l'instant (hors ligne, en mouvement, inconnu ou illisible) : la commande est refusée.",
    },
    modeLocked: {
      en: 'Flo has locked the mode of this device: change it in the Moen app.',
      fr: "Flo a verrouillé le mode de cet appareil : changez-le dans l'application Moen.",
    },
    sleep: {
      en: 'Sleep mode needs a duration: set it in the Moen app. Gladys sets Home or Away only.',
      fr: "Le mode veille demande une durée : réglez-le dans l'application Moen. Gladys ne règle que Maison ou Absent.",
    },
    refused: {
      en: 'Flo refused the e-mail or the password: no command is sent until they are fixed.',
      fr: "Flo a refusé l'e-mail ou le mot de passe : aucune commande n'est envoyée avant leur correction.",
    },
    notReady: {
      en: 'The Flo account has not been read yet: try again in a minute.',
      fr: "Le compte Flo n'a pas encore été lu : réessayez dans une minute.",
    },
  },
  test: {
    cooldown: {
      en: 'Already read less than 30 seconds ago.',
      fr: 'Déjà lu il y a moins de 30 secondes.',
    },
    summary: ({ shutoffs, sensors, skipped, locations, method }) => ({
      en: `${plural(locations, 'home', 'homes')}, ${plural(shutoffs, 'Smart Water Shutoff', 'Smart Water Shutoffs')}, ${plural(sensors, 'Water Sensor', 'Water Sensors')}${skipped ? `, ${plural(skipped, 'other device', 'other devices')} not supported` : ''}. Signed in with the ${method === 'moen' ? 'Moen' : 'Flo'} sign-in.`,
      fr: `${plural(locations, 'logement', 'logements')}, ${plural(shutoffs, "vanne d'arrêt", "vannes d'arrêt")}, ${plural(sensors, 'détecteur de fuite', 'détecteurs de fuite')}${skipped ? `, ${plural(skipped, 'autre appareil non pris en charge', 'autres appareils non pris en charge')}` : ''}. Connexion par l'identification ${method === 'moen' ? 'Moen' : 'Flo'}.`,
    }),
  },
};
