import Telnyx from 'telnyx';
const telnyx = Telnyx('FAKE');
console.log(Object.keys(telnyx.calls));
console.log(typeof telnyx.calls.retrieveStatus);
