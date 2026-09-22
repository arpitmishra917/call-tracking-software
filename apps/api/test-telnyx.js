import Telnyx from 'telnyx';
const client = Telnyx.default ? Telnyx.default('dummy') : Telnyx('dummy');
console.log(Object.keys(client));
