// The places a DNS-01 challenge record can be written. A provider is an object with
// create(name, value), remove(name, value) and optionally visible(name, value): see dnsChallenge.js.
// Each entry builds its provider when it is needed, so a provider that is not used costs nothing.
const FACTORIES = {};

const names = () => Object.keys(FACTORIES);

function get(name) {
    if (!name) {
        throw new Error(
            `FREYA_ACME_DNS_PROVIDER is required for the dns-01 challenge. Available: ${names().join(', ') || 'none yet'}.`
        );
    }
    if (!Object.hasOwn(FACTORIES, name)) {
        throw new Error(`FREYA_ACME_DNS_PROVIDER ${name} is not known. Available: ${names().join(', ') || 'none yet'}.`);
    }
    return FACTORIES[name]();
}

module.exports = { get, names, FACTORIES };
