const Telnyx = require('telnyx');
require('dotenv').config();

async function run() {
  const telnyxClient = new Telnyx(process.env.TELNYX_API_KEY);
  
  // Test Local
  const localFilter = { country_code: 'US', limit: 1, phone_number_type: 'local' };
  const res1 = await telnyxClient.availablePhoneNumbers.list({ filter: localFilter });
  console.log('Local Filter Result:', res1.data[0]);

  // Test Toll Free
  const tfFilter = { country_code: 'US', limit: 1, phone_number_type: 'toll_free' };
  const res2 = await telnyxClient.availablePhoneNumbers.list({ filter: tfFilter });
  console.log('TollFree Filter Result:', res2.data[0]);

  // Test Number Type
  const altFilter = { country_code: 'US', limit: 1, number_type: 'local' };
  const res3 = await telnyxClient.availablePhoneNumbers.list({ filter: altFilter });
  console.log('Alt Filter Result:', res3.data[0]);
}
run();
