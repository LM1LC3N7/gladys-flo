# Flo by Moen

Cette intégration amène dans Gladys la vanne d'arrêt **Flo by Moen Smart Water
Shutoff** et les détecteurs de fuite **Flo Water Sensor**, par le cloud Flo
qu'utilise l'application Moen Smartwater (anciennement Flo), avec l'e-mail et
le mot de passe de votre compte. Ces produits sont vendus aux États-Unis et au
Canada. Non officielle, sans lien avec Moen ni Fortune Brands.

> **Version de développement (0.1).** Écrite d'après la bibliothèque Python
> `aioflo` (celle de l'intégration Flo de Home Assistant). L'intégration n'a
> **jamais été testée sur un vrai appareil ni sur un vrai compte** : seulement
> avec des réponses simulées. Vos retours sont les bienvenus sur le dépôt
> GitHub.

## Ce que vous obtenez

| Appareil Flo                      | Dans Gladys                                                                                                                                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Smart Water Shutoff (vanne)       | vanne ouverte/fermée et mode absent (commandables, voir « Sécurité »), mode (texte : home, away, sleep), débit m³/h, pression psi, température de l'eau °C, consommation du jour en litres, alerte fuite, alertes en attente (texte) |
| Water Sensor (détecteur de fuite) | fuite d'eau, température °C, humidité %, batterie %                                                                                                                                                                                  |

Les autres appareils Flo (pont, etc.) sont ignorés : le bouton **Tester la
connexion** les compte.

Unités : le débit est converti de gallons par minute en m³/h, la consommation
de gallons en litres, les températures de °F en °C (Gladys les affiche selon
vos préférences). La pression reste en psi. Une vanne sans sonde de
température d'eau envoie une valeur factice (225 °F) : elle est ignorée.

## Installation

1. Installez l'intégration depuis le store de Gladys.
2. Dans l'onglet **Configuration**, saisissez l'e-mail et le mot de passe de
   votre compte Flo ou Moen Smartwater, puis enregistrez. L'état indique
   « Connecté à Flo : 2 appareils. »
3. Ouvrez l'onglet **Découverte** et ajoutez les appareils voulus. Leurs
   valeurs arrivent dès l'ajout.

**Identification** : « Automatique » (par défaut) essaie l'identification Flo
historique, puis celle de Moen (comptes Moen Smartwater récents) si Flo refuse
ou ne répond plus à cette adresse. Une fois Flo refusé, seule Moen est essayée
jusqu'à une modification de la configuration. Vous pouvez forcer l'une ou
l'autre.

## Sécurité : commandes désactivées par défaut

Ces commandes sont refusées tant que vous ne les autorisez pas dans la
configuration :

| Option                                        | Par défaut | Désactivée : Gladys…         |
| --------------------------------------------- | ---------- | ---------------------------- |
| Autoriser la fermeture de la vanne            | non        | ne ferme jamais l'eau        |
| Autoriser l'ouverture de la vanne             | non        | ne rouvre jamais l'eau       |
| Autoriser le changement de mode Maison/Absent | non        | ne change jamais le mode Flo |

Pour couper l'eau depuis une scène en cas de fuite, activez « Autoriser la
fermeture de la vanne ». Même autorisée, une commande de vanne :

- passe **une par une** pour un même appareil (deux « fermer » simultanés ne
  sont jamais envoyés ensemble) ;
- relit l'appareil chez Flo **juste avant d'agir** : si cette lecture échoue,
  si l'appareil est hors ligne, si la vanne bouge dans l'autre sens ou est
  dans un état inconnu, la commande est **refusée** ; l'état gardé en mémoire
  ne décide jamais ;
- n'envoie rien si la vanne est déjà dans la position demandée, ou s'y rend
  déjà ;
- est **refusée plutôt qu'envoyée en retard** si elle n'a pas pu partir à
  temps (3,5 secondes après la demande depuis le tableau de bord, 25 secondes
  pour une action de scène) : Gladys aurait déjà affiché un échec ;
- relit l'appareil 15 secondes puis 60 secondes après (même en cas d'échec),
  pour afficher la position réelle.

**Attention : dès qu'une option de vanne est activée, la vanne est un
interrupteur Gladys comme un autre.** Un assistant vocal, une commande
« tout éteindre » ou une scène qui agit sur tous les interrupteurs peut alors
fermer (ou ouvrir) l'eau. Vérifiez vos scènes et vos assistants avant
d'activer ces options.

**Mode Maison / Absent** (interrupteur « Mode absent » ou action de scène) :
désactivé par défaut. **Passer en Maison désarme la coupure automatique que
Flo applique en mode Absent** : n'activez l'option qu'en connaissance de cause.
Le mode **Veille** demande une durée : il s'affiche mais se règle dans
l'application Moen. Un mode verrouillé par Flo est refusé.

## Scènes

Déclencheurs :

- **Flo : fuite détectée** : un Water Sensor détecte de l'eau, ou Flo lève une
  nouvelle alerte de fuite **critique ou d'avertissement** (eau détectée,
  goutte à goutte, test d'étanchéité échoué) ; filtrable par gravité ;
- **Flo : débit anormal** : nouvelle alerte critique ou d'avertissement de
  débit rapide, d'écoulement prolongé ou de forte consommation ;
- **Flo : nouvelle alerte** : toute nouvelle alerte, filtrable par gravité et
  par famille.

Un déclencheur part une fois par nouvelle alerte, au rafraîchissement qui la
découvre (une alerte toujours en attente ne se redéclenche pas). Ce que
l'intégration a vu en dernier est gardé dans `/data` : une alerte apparue
pendant un redémarrage déclenche au démarrage suivant. Les alertes d'un
appareil jamais vu auparavant ne déclenchent pas (rien ne dit qu'elles sont
nouvelles).

La famille d'une alerte (fuite, débit, autre) vient de son nom dans le
catalogue Flo, lu une fois par jour, comparé à une liste de noms connus. **Si
le catalogue est indisponible** (ou si une alerte n'y figure pas), l'alerte
est classée « autre » : seul « nouvelle alerte » se déclenche, et, par
prudence, une alerte critique inconnue allume « Alerte fuite ». La
fonctionnalité « Alertes en attente » liste toujours toutes les alertes.

**Recommandé pour couper l'eau** : en plus de « fuite détectée », créez une
scène sur le déclencheur **« changement d'état d'un appareil »** de la
fonctionnalité **Fuite d'eau** du Water Sensor (ou **Alerte fuite** de la
vanne) passant à 1. Cet état est relu à chaque rafraîchissement, même si un
événement de scène a été manqué.

Actions : **Flo : passer en Maison ou Absent** (un logement ou tous) et
**Flo : ouvrir ou fermer la vanne**, soumises aux options ci-dessus.

## Limites d'usage

- Flo ne publie pas de limite d'API. L'intégration lit le compte et chaque
  appareil toutes les 2 minutes par défaut (réglable de 1 à 60), la
  consommation du jour toutes les 15 minutes, le catalogue des alertes une
  fois par jour : c'est le rythme de Home Assistant (1 minute) ou plus lent.
- Si Flo répond « trop de requêtes » (429), l'intégration fait une pause de la
  durée demandée (1 minute à 1 heure, 5 minutes sans précision). En cas
  d'erreur réseau ou de panne de Flo, elle réessaie après 1, 2, 5, 10 puis 15
  minutes.
- Un e-mail ou un mot de passe refusé n'est jamais réessayé seul :
  l'intégration attend une modification ou un clic sur **Tester la
  connexion**.
- Les valeurs arrivent au rythme du rafraîchissement, pas en temps réel.
- Gladys accepte 300 états par minute : seules les valeurs qui changent sont
  envoyées (et chaque valeur au moins toutes les 30 minutes).

## Options

| Option                                        | Défaut      | Rôle                                           |
| --------------------------------------------- | ----------- | ---------------------------------------------- |
| E-mail, mot de passe                          | —           | votre compte Flo / Moen Smartwater             |
| Autoriser la fermeture de la vanne            | non         | voir « Sécurité »                              |
| Autoriser l'ouverture de la vanne             | non         | voir « Sécurité »                              |
| Autoriser le changement de mode Maison/Absent | non         | voir « Sécurité »                              |
| Identification                                | Automatique | Flo puis Moen, ou l'une des deux               |
| Intervalle de rafraîchissement (min)          | 2           | fréquence de lecture des appareils             |
| Langue des noms des fonctionnalités           | Français    | noms des fonctionnalités des appareils ajoutés |

## Dépannage

- **« Flo a refusé l'e-mail ou le mot de passe »** : vérifiez-les dans
  l'application Moen Smartwater. Essayez l'identification « Moen » si votre
  compte a été créé dans l'application Moen.
- **« Flo est injoignable »** : panne de Flo ou de votre connexion ;
  l'intégration réessaie seule.
- **Badge `injoignable` avec un point orange** : Flo signale l'appareil hors
  ligne (Wi-Fi, piles du détecteur).
- **« L'état de la vanne Flo n'a pas pu être confirmé »** : la vanne était
  hors ligne, en mouvement ou illisible au moment de la commande ; réessayez
  plus tard.
- **« La commande a attendu trop longtemps son tour »** : Flo a répondu
  lentement ; réessayez.

## Confidentialité

L'e-mail et le mot de passe sont **gardés par Gladys dans sa base de données**
(et donc dans ses sauvegardes) ; le mot de passe n'est jamais réaffiché dans
l'interface. Ils ne sont envoyés qu'aux points de connexion Flo
(`api.meetflo.com`) et Moen (Amazon Cognito,
`execute-api.us-east-2.amazonaws.com`), en HTTPS. Le jeton obtenu reste en
mémoire et n'apparaît dans aucun journal. Le seul fichier écrit dans `/data`
(`flo-seen.json`) contient les compteurs d'alertes et l'état « eau détectée »
de chaque appareil, sans aucun secret.

Flo by Moen et Moen sont des marques de Moen Incorporated (Fortune Brands) ;
cette intégration est sans lien avec Moen.
