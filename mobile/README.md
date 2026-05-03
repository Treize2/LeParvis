# LeParvis · Mobile (Expo / React Native)

Application native iOS + Android construite avec Expo SDK 52, TypeScript et
expo-router. Elle consomme la même API que le frontend web
(`https://leparvis.dauchez.me`).

## Démarrage

```bash
cd mobile
npm install
npx expo start
```

- `i` ouvre le simulateur iOS · `a` lance Android · `w` ouvre la version web (dégradée).
- L'URL d'API est définie dans `app.json` → `expo.extra.apiBaseUrl`.
  Pour pointer vers une instance locale du backend, exporte
  `EXPO_PUBLIC_API_URL=http://192.168.x.x:8000` avant `expo start`.

## Structure

```
mobile/
├── app/                   # routes (file-based) — expo-router
│   ├── _layout.tsx        # racine + provider de filtres
│   ├── index.tsx          # écran d'accueil + recherche + liste
│   ├── filters.tsx        # modale filtres
│   ├── map.tsx            # carte (react-native-maps)
│   └── church/[id].tsx    # fiche d'un lieu + horaires + ICS
└── src/
    ├── api.ts             # client HTTP (search/getChurch/getTaxonomy)
    ├── types.ts           # types miroirs des schémas Pydantic
    ├── theme.ts           # palette + helpers (formatTime, dayLabel)
    ├── components/        # ChurchCard, CelebrationLine, ChipRow, EmptyState
    ├── hooks/             # useTaxonomy, useSearch
    └── state/             # FiltersProvider (Context)
```

## Fonctionnalités

- Recherche plein texte + filtres (type de lieu, célébration, communauté, rite, jour).
- Géolocalisation native (`expo-location`) avec rayon configurable.
- Vue liste + vue carte (`react-native-maps`).
- Fiche lieu : adresse cliquable (Apple/Google Maps), téléphone (`tel:`),
  email (`mailto:`), site web, ajout d'une célébration au calendrier (ICS).
- Indicateur de filtres actifs sur le bouton « Filtres ».

## Qualité

```bash
npm run typecheck      # tsc --noEmit
npm run lint           # expo lint
npm test               # jest (smoke tests sur l'API client)
```

## Builds natifs (stores)

Les builds production sont gérés par EAS Build :

```bash
npm i -g eas-cli
eas login
eas build:configure
eas build --profile preview --platform ios       # TestFlight interne
eas build --profile production --platform all    # App Store + Play Store
```

Ce qu'il te faudra côté comptes :

| Compte / clé             | Coût        | Pourquoi                                  |
|--------------------------|-------------|-------------------------------------------|
| Apple Developer Program  | 99 $ / an   | Distribuer sur App Store + TestFlight     |
| Google Play Console      | 25 $ unique | Distribuer sur Play Store                 |
| Expo (gratuit)           | —           | EAS Build / Submit                        |
| Google Maps API Key      | gratuit T1  | Maps sur Android (à coller dans `app.json`)|

> Sur iOS, Apple Maps fonctionne nativement sans clé. Sur Android, sans clé
> Google Maps la carte affichera un fond gris — l'app reste fonctionnelle
> mais sans tuiles.

## Déclaration de l'app à Apple / Google

Identifiants déjà déclarés dans `app.json` :

- iOS : `me.dauchez.leparvis`
- Android : `me.dauchez.leparvis`

Change-les si tu veux un autre namespace ; assure-toi que les certificats
EAS soient régénérés (`eas credentials`).

## Assets manquants

`assets/icon.png`, `assets/splash.png`, `assets/adaptive-icon.png`,
`assets/favicon.png` ne sont pas commités (binaires). Génère-les avec
[Expo's icon generator](https://docs.expo.dev/guides/app-icons/) puis copie-les
dans `mobile/assets/`. En attendant, Expo affichera son logo par défaut.
