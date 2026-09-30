Chengyin Mini Program — standalone client source candidate

This directory contains only the Mini Program client, not the Java backend,
database, operations tooling, original Git history or original Actions logs.

Development: Node.js 24. Run npm ci --ignore-scripts, npm run lint:scope,
and npm run test:public. Import this directory in WeChat Developer Tools.
project.config.json uses touristappid. Supply your own AppID and configure
utils/config.js for your own backend. api.example.invalid deliberately does
not resolve. The support number 18000000000 is a placeholder, not a contact.
Never put AppSecret, payment private keys or backend credentials in a client.

tests/public-test-scope.json lists excluded tests and reasons: they depend on
the private monorepo, internal evidence or unpublished tooling. These checks
remain a separate private responsibility. Public checks do not prove real
device behavior, production compatibility or complete visual acceptance.

CI uses GitHub standard hosted runners, read-only repository access and no
production credentials. Jobs intentionally skip private repositories to avoid
paid usage during preparation. No automatic deployment or store upload exists.
The source has not yet passed a cloud run in its future standalone repository.

No new blanket MIT grant is made for original project code. Existing upstream
licenses remain applicable, including the inherited RuoYi notice in
THIRD_PARTY_LICENSES/RuoYi-MIT.txt and images/publish-quick/LICENSE.
Public visibility does not revoke existing upstream rights. Ownership and
redistribution rights for remaining artwork require owner verification.
