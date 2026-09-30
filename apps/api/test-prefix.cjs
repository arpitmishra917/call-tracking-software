const Telnyx = require('telnyx');
require('dotenv').config();

async function run() {
  const telnyxClient = new Telnyx(process.env.TELNYX_API_KEY);
  
  // Test Prefix 888
  const filter1 = { country_code: 'US', limit: 1, phone_number: { starts_with: '888' } };
  const res1 = await telnyxClient.availablePhoneNumbers.list({ filter: filter1 });
  console.log('Prefix "888" Result Count:', res1.data.length);

  // Test Prefix +1888
  const filter2 = { country_code: 'US', limit: 1, phone_number: { starts_with: '+1888' } };
  const res2 = await telnyxClient.availablePhoneNumbers.list({ filter: filter2 });
  console.log('Prefix "+1888" Result Count:', res2.data.length);
  if (res2.data.length > 0) console.log('First:', res2.data[0].phone_number);
}
run();
