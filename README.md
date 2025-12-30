### Cross-Platform-Bitcoin-Wallet

This is a template for users to

1. Authenticate accounts using the nostr protocol
2. Create a cross platform wallet using nostr and cashu protocols
   - Create a wallet
   - Deposit
   - send money to a recipient
   - receive/redeem tokens

- [Run Application Instructions](#run-application)

- [Specific Installations](#dependencies-information)

- [Specific Installations](#dependencies-information)

- [Notes About Implementation](#notes-about-implementation)

### Run applications

1. Clone this repo (or fork and clone it)
2. Change directories to /wallet using `cd wallet`
3. `npm install`
4. `npm run dev`

Demo application: https://beautiful-snickerdoodle-86f087.netlify.app/

### Dependencies information

Some of the packages installed in `package.json` use specific versions.

#### <u>Specific installations</u>

- At the time of this writing (December 2025), we're using version 0.7.0. This library has changed significantly a number of times and this template is written specifically for this version.

```
    "@nostr-dev-kit/ndk-wallet": "^0.7.0",
```

- At the time of this writing, this is not the most up to date version (2.18 is). However, version 3.0 will likely release soon and may include significant changes.

```
    "@nostr-dev-kit/ndk": "^2.14.9",
```

### Notes about implementation

##### Keypairs

The app says "Create Account" which is generating a keypair. Users that create an account will get an "npub" which is essentially a user ID and a "nsec" which is a secret key or password generated for them.

You can use your key to log into a number of decentralized applications built on top of the nostr protocol like

- https://primal.net (social media)
- https://robotsbuildingeducation.com (coding education app)
- https://nosabos.app (language learning app)

##### Wallet

When you create a wallet, it essentially becomes tied to you account. So if you run this application and run one of the educations apps above, then send a transaction, youll notice your wallets update on both apps.

Essentially, you're able to tie spending events to user events. So you can move globally money by answering a question, liking a post or pretty much anything you can do on the internet without the permission. It just works. I think this has pretty profound consequences that make internet properties more material for communities and people.
