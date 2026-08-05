# MELCloud Home

Pilotez vos climatisations Mitsubishi Electric via le cloud MELCloud Home.

## Prérequis

- Un compte **MELCloud Home** (`melcloudhome.com`) — la nouvelle plateforme
  Mitsubishi Electric. Si votre compte a été créé sur l'ancien MELCloud
  (`app.melcloud.com`), il ne fonctionnera **pas** ici : les deux plateformes
  sont distinctes.
- Vos climatisations déjà ajoutées à votre compte MELCloud Home (via
  l'application mobile MELCloud Home).

## Configuration

1. Saisissez l'**email** et le **mot de passe** de votre compte MELCloud Home.
   Ils sont stockés chiffrés par Gladys et servent uniquement à s'authentifier
   auprès de MELCloud Home.
2. Choisissez éventuellement un **intervalle de rafraîchissement** (fréquence de
   relève de l'état). La liste ne propose que les intervalles supportés par
   Gladys ; par défaut, toutes les minutes, ce qui suffit largement pour une
   API cloud.
3. Enregistrez. Utilisez **Tester la connexion** pour vérifier vos identifiants.

## Ajouter vos appareils

Vos unités sont publiées dès que l'intégration se connecte : elles apparaissent
donc déjà dans l'écran Découverte — lancez un scan pour rafraîchir la liste.

- Les **unités air-air (climatisations)** exposent quatre fonctionnalités —
  **Marche/Arrêt**, **Mode** (chaud / froid / déshumidification / ventilation /
  auto), **Température de consigne** et une **Température ambiante** en lecture
  seule.
- Les **unités air-eau (pompes à chaleur Ecodan)** exposent **Marche/Arrêt**,
  une consigne **Température zone 1** et la **Température ambiante zone 1** en
  lecture seule, un capteur **Température extérieure**, et — si un ballon d'eau
  chaude est présent — **Température eau chaude** (consigne), une **Température
  du ballon** en lecture seule et un interrupteur **Eau chaude forcée**.

Créez celles que vous souhaitez piloter.

## Remarques

- Les unités air-air (climatisations) et air-eau (pompes à chaleur Ecodan) sont
  prises en charge. Les VMC double flux sont ignorées.
- Le mode de fonctionnement de zone (loi d'eau, consigne sur départ d'eau ou
  thermostat d'ambiance) n'est pas encore pilotable sur les unités air-eau.
- L'état de la connexion est affiché sur cet écran ; en cas d'échec de
  connexion, vérifiez votre email et votre mot de passe.
