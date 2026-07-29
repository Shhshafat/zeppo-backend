const axios = require('axios');

const API_URL = 'https://zeppo-backend.onrender.com';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function deleteMenu() {
  try {
    console.log('Restaurants dhoond raha hoon...');
    const restRes = await axios.get(API_URL + '/api/restaurants');
    const restaurant = restRes.data.find((r) => r.name.toLowerCase().includes('zafira'));

    if (!restaurant) {
      console.log('❌ Al-Zafira restaurant nahi mila!');
      return;
    }

    console.log('✅ Mil gaya: ' + restaurant.name + ' (ID: ' + restaurant.id + ')');

    const menuRes = await axios.get(API_URL + '/api/menu/' + restaurant.id);
    const items = menuRes.data;

    console.log(items.length + ' purane items mile. Delete kar raha hoon...\n');

    let deletedCount = 0;
    for (const item of items) {
      try {
        await axios.post(API_URL + '/api/menu/delete', { id: item.id });
        deletedCount++;
        console.log('  🗑️ ' + item.name);
        await delay(300); // thoda ruk ruk ke, rate limit se bachne ke liye
      } catch (e) {
        console.log('  ❌ Failed to delete: ' + item.name);
      }
    }

    console.log('\n🎉 Done! ' + deletedCount + '/' + items.length + ' items delete ho gaye.');
  } catch (e) {
    console.error('Error:', e.message);
  }
}

deleteMenu();
