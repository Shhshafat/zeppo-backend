const axios = require('axios');

const API_URL = 'https://zeppo-backend.onrender.com';

const categoryImages = {
  'Chicken Gravy Specials': 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=400&q=80',
  'Veg Specials': 'https://images.unsplash.com/photo-1631452180775-6d34b4c58398?w=400&q=80',
  'Rice & Biryani': 'https://images.unsplash.com/photo-1589302168068-964664d93dc0?w=400&q=80',
  'Tandoori Specials': 'https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?w=400&q=80',
  'Kebabs & Fried Items': 'https://images.unsplash.com/photo-1606491956689-2ea866880c84?w=400&q=80',
  'Chicken Tikka Varieties': 'https://images.unsplash.com/photo-1606491956689-2ea866880c84?w=400&q=80',
  'Shawarma Special': 'https://images.unsplash.com/photo-1529006557810-274b9b2fc783?w=400&q=80',
  'Sizzler Special': 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=400&q=80',
  'Breads & Naan': 'https://images.unsplash.com/photo-1626074353765-517a681e40be?w=400&q=80',
  'Beverages': 'https://images.unsplash.com/photo-1571934811356-5cc061b6821f?w=400&q=80',
  'Desserts': 'https://images.unsplash.com/photo-1551024506-0bccd828d307?w=400&q=80',
  'default': 'https://images.unsplash.com/photo-1633945274405-b6c8069047b0?w=400&q=80',
};

const menu = [
  // ===== CHICKEN GRAVY SPECIALS (Qtr/Half/Full) =====
  { category: 'Chicken Gravy Specials', name: 'Al-Zafira Special', is_veg: 0, portions: [{ name: 'Quarter', price: 250 }, { name: 'Half', price: 500 }, { name: 'Full', price: 1000 }] },
  { category: 'Chicken Gravy Specials', name: 'Chicken Korma', is_veg: 0, portions: [{ name: 'Quarter', price: 150 }, { name: 'Half', price: 300 }, { name: 'Full', price: 600 }] },
  { category: 'Chicken Gravy Specials', name: 'Chicken Kali Mirch', is_veg: 0, portions: [{ name: 'Quarter', price: 180 }, { name: 'Half', price: 360 }, { name: 'Full', price: 720 }] },
  { category: 'Chicken Gravy Specials', name: 'Chicken Changezi', is_veg: 0, portions: [{ name: 'Quarter', price: 150 }, { name: 'Half', price: 300 }, { name: 'Full', price: 600 }] },
  { category: 'Chicken Gravy Specials', name: 'Chicken Lababdar', is_veg: 0, portions: [{ name: 'Quarter', price: 160 }, { name: 'Half', price: 320 }, { name: 'Full', price: 640 }] },
  { category: 'Chicken Gravy Specials', name: 'Chicken Hyderabadi', is_veg: 0, portions: [{ name: 'Quarter', price: 150 }, { name: 'Half', price: 300 }, { name: 'Full', price: 600 }] },
  { category: 'Chicken Gravy Specials', name: 'Chicken Hariyali', is_veg: 0, portions: [{ name: 'Quarter', price: 160 }, { name: 'Half', price: 320 }, { name: 'Full', price: 640 }] },
  { category: 'Chicken Gravy Specials', name: 'Chicken Mughlai', is_veg: 0, portions: [{ name: 'Quarter', price: 200 }, { name: 'Half', price: 400 }, { name: 'Full', price: 800 }] },
  { category: 'Chicken Gravy Specials', name: 'Chicken Kadai', is_veg: 0, portions: [{ name: 'Quarter', price: 170 }, { name: 'Half', price: 340 }, { name: 'Full', price: 680 }] },
  { category: 'Chicken Gravy Specials', name: 'Chicken Do Pyaza', is_veg: 0, portions: [{ name: 'Quarter', price: 170 }, { name: 'Half', price: 340 }, { name: 'Full', price: 680 }] },
  { category: 'Chicken Gravy Specials', name: 'Chicken Curry', is_veg: 0, portions: [{ name: 'Quarter', price: 140 }, { name: 'Half', price: 280 }, { name: 'Full', price: 560 }] },
  { category: 'Chicken Gravy Specials', name: 'Lemon Chicken', is_veg: 0, portions: [{ name: 'Quarter', price: 150 }, { name: 'Half', price: 300 }, { name: 'Full', price: 600 }] },
  { category: 'Chicken Gravy Specials', name: 'Chicken Rara Masala', is_veg: 0, portions: [{ name: 'Quarter', price: 190 }, { name: 'Half', price: 380 }, { name: 'Full', price: 760 }] },
  { category: 'Chicken Gravy Specials', name: 'Chicken Lahori', is_veg: 0, portions: [{ name: 'Quarter', price: 170 }, { name: 'Half', price: 340 }, { name: 'Full', price: 680 }] },
  { category: 'Chicken Gravy Specials', name: 'Chicken Rasila', is_veg: 0, portions: [{ name: 'Quarter', price: 180 }, { name: 'Half', price: 360 }, { name: 'Full', price: 720 }] },
  { category: 'Chicken Gravy Specials', name: 'Chicken Achari', is_veg: 0, portions: [{ name: 'Quarter', price: 140 }, { name: 'Half', price: 280 }, { name: 'Full', price: 660 }] },
  { category: 'Chicken Gravy Specials', name: 'Chicken Masala', is_veg: 0, portions: [{ name: 'Quarter', price: 150 }, { name: 'Half', price: 300 }, { name: 'Full', price: 600 }] },
  { category: 'Chicken Gravy Specials', name: 'Chicken Tiranga', is_veg: 0, portions: [{ name: 'Quarter', price: 200 }, { name: 'Half', price: 400 }, { name: 'Full', price: 800 }] },
  { category: 'Chicken Gravy Specials', name: 'Butter Chicken', is_veg: 0, portions: [{ name: 'Quarter', price: 180 }, { name: 'Half', price: 360 }, { name: 'Full', price: 720 }] },
  { category: 'Chicken Gravy Specials', name: 'Malai Chicken', is_veg: 0, portions: [{ name: 'Quarter', price: 160 }, { name: 'Half', price: 320 }, { name: 'Full', price: 640 }] },
  { category: 'Chicken Gravy Specials', name: 'Chicken Afghani', is_veg: 0, portions: [{ name: 'Quarter', price: 180 }, { name: 'Half', price: 360 }, { name: 'Full', price: 720 }] },
  { category: 'Chicken Gravy Specials', name: 'Chicken Patiala', is_veg: 0, portions: [{ name: 'Quarter', price: 170 }, { name: 'Half', price: 340 }, { name: 'Full', price: 680 }] },
  { category: 'Chicken Gravy Specials', name: 'Chicken Lapeta', is_veg: 0, portions: [{ name: 'Quarter', price: 200 }, { name: 'Half', price: 400 }, { name: 'Full', price: 800 }] },
  { category: 'Chicken Gravy Specials', name: 'Chicken Chatpata Masala', is_veg: 0, portions: [{ name: 'Quarter', price: 140 }, { name: 'Half', price: 280 }, { name: 'Full', price: 560 }] },
  { category: 'Chicken Gravy Specials', name: 'Chicken Handi', is_veg: 0, portions: [{ name: 'Quarter', price: 170 }, { name: 'Half', price: 340 }, { name: 'Full', price: 680 }] },
  { category: 'Chicken Gravy Specials', name: 'Chicken Garlic', is_veg: 0, portions: [{ name: 'Quarter', price: 150 }, { name: 'Half', price: 300 }, { name: 'Full', price: 600 }] },
  { category: 'Chicken Gravy Specials', name: 'Shahi Chicken', is_veg: 0, portions: [{ name: 'Quarter', price: 150 }, { name: 'Half', price: 300 }, { name: 'Full', price: 600 }] },
  { category: 'Chicken Gravy Specials', name: 'Chicken Kolhapuri', is_veg: 0, portions: [{ name: 'Quarter', price: 160 }, { name: 'Half', price: 320 }, { name: 'Full', price: 640 }] },
  { category: 'Chicken Gravy Specials', name: 'Chicken Kaju Masala', is_veg: 0, portions: [{ name: 'Quarter', price: 150 }, { name: 'Half', price: 300 }, { name: 'Full', price: 600 }] },
  { category: 'Chicken Gravy Specials', name: 'Chicken Rogan Josh', is_veg: 0, portions: [{ name: 'Quarter', price: 150 }, { name: 'Half', price: 300 }, { name: 'Full', price: 600 }] },
  { category: 'Chicken Gravy Specials', name: 'Chicken Angara', is_veg: 0, portions: [{ name: 'Quarter', price: 170 }, { name: 'Half', price: 340 }, { name: 'Full', price: 680 }] },

  // ===== VEG SPECIALS =====
  { category: 'Veg Specials', name: 'Paneer Kadai', is_veg: 1, price: 150 },
  { category: 'Veg Specials', name: 'Shahi Paneer', is_veg: 1, price: 150 },
  { category: 'Veg Specials', name: 'Paneer Kolhapuri', is_veg: 1, price: 150 },
  { category: 'Veg Specials', name: 'Butter Paneer', is_veg: 1, price: 160 },
  { category: 'Veg Specials', name: 'Paneer Do Pyaza', is_veg: 1, price: 160 },
  { category: 'Veg Specials', name: 'Paneer Kali Mirch', is_veg: 1, price: 160 },

  // ===== RICE & BIRYANI (Half/Full) =====
  { category: 'Rice & Biryani', name: 'Chicken Hyderabadi Biryani', is_veg: 0, portions: [{ name: 'Half', price: 120 }, { name: 'Full', price: 240 }] },
  { category: 'Rice & Biryani', name: 'Chicken Saffron Biryani', is_veg: 0, portions: [{ name: 'Half', price: 140 }, { name: 'Full', price: 280 }] },
  { category: 'Rice & Biryani', name: 'Chicken Dum Biryani', is_veg: 0, portions: [{ name: 'Half', price: 120 }, { name: 'Full', price: 240 }] },
  { category: 'Rice & Biryani', name: 'Plain Rice', is_veg: 1, portions: [{ name: 'Half', price: 50 }, { name: 'Full', price: 100 }] },
  { category: 'Rice & Biryani', name: 'Jeera Rice', is_veg: 1, portions: [{ name: 'Half', price: 70 }, { name: 'Full', price: 140 }] },

  // ===== TANDOORI SPECIALS (Half/Full) =====
  { category: 'Tandoori Specials', name: 'Chicken Tandoori', is_veg: 0, portions: [{ name: 'Half', price: 200 }, { name: 'Full', price: 400 }] },
  { category: 'Tandoori Specials', name: 'Chicken Afghani Tandoori', is_veg: 0, portions: [{ name: 'Half', price: 230 }, { name: 'Full', price: 460 }] },
  { category: 'Tandoori Specials', name: 'Chicken Roasted', is_veg: 0, portions: [{ name: 'Half', price: 240 }, { name: 'Full', price: 480 }] },
  { category: 'Tandoori Specials', name: 'Chicken Roasted Creamy', is_veg: 0, portions: [{ name: 'Half', price: 240 }, { name: 'Full', price: 480 }] },

  // ===== KEBABS & FRIED ITEMS =====
  { category: 'Kebabs & Fried Items', name: 'Chicken Seekh Kebab', is_veg: 0, price: 40 },
  { category: 'Kebabs & Fried Items', name: 'Chicken Creamy Seekh Kebab', is_veg: 0, price: 50 },
  { category: 'Kebabs & Fried Items', name: 'Chicken Lollipop Fry', is_veg: 0, portions: [{ name: '6 Pc', price: 180 }, { name: '12 Pc', price: 360 }] },

  // ===== CHICKEN TIKKA VARIETIES (6pc/12pc) =====
  { category: 'Chicken Tikka Varieties', name: 'Chicken Malai Tikka', is_veg: 0, portions: [{ name: '6 Pc', price: 180 }, { name: '12 Pc', price: 360 }] },
  { category: 'Chicken Tikka Varieties', name: 'Tandoori Chicken Tikka', is_veg: 0, portions: [{ name: '6 Pc', price: 180 }, { name: '12 Pc', price: 360 }] },
  { category: 'Chicken Tikka Varieties', name: 'Chicken Afghani Tikka', is_veg: 0, portions: [{ name: '6 Pc', price: 180 }, { name: '12 Pc', price: 360 }] },
  { category: 'Chicken Tikka Varieties', name: 'Chicken Achari Tikka', is_veg: 0, portions: [{ name: '6 Pc', price: 180 }, { name: '12 Pc', price: 360 }] },
  { category: 'Chicken Tikka Varieties', name: 'Chicken Lemon Tikka', is_veg: 0, portions: [{ name: '6 Pc', price: 180 }, { name: '12 Pc', price: 360 }] },
  { category: 'Chicken Tikka Varieties', name: 'Chicken Beetroot Tikka', is_veg: 0, portions: [{ name: '6 Pc', price: 180 }, { name: '12 Pc', price: 360 }] },
  { category: 'Chicken Tikka Varieties', name: 'Chicken Hariyali Tikka', is_veg: 0, portions: [{ name: '6 Pc', price: 180 }, { name: '12 Pc', price: 360 }] },
  { category: 'Chicken Tikka Varieties', name: 'Chicken Angara Tikka', is_veg: 0, portions: [{ name: '6 Pc', price: 180 }, { name: '12 Pc', price: 360 }] },

  // ===== SHAWARMA SPECIAL =====
  { category: 'Shawarma Special', name: 'Chicken Charcoal Shawarma Special', is_veg: 0, price: 70 },

  // ===== SIZZLER SPECIAL =====
  { category: 'Sizzler Special', name: 'Fire Chicken Rara Masala', is_veg: 0, price: 230 },
  { category: 'Sizzler Special', name: 'Fire Chicken Mughlai', is_veg: 0, price: 240 },
  { category: 'Sizzler Special', name: 'Fire Chicken Lahori', is_veg: 0, price: 210 },
  { category: 'Sizzler Special', name: 'Fire Chicken Afghani Tikka', is_veg: 0, portions: [{ name: '6 Pc', price: 200 }, { name: '12 Pc', price: 400 }] },
  { category: 'Sizzler Special', name: 'Fire Chicken Angara Tikka', is_veg: 0, portions: [{ name: '6 Pc', price: 200 }, { name: '12 Pc', price: 400 }] },
  { category: 'Sizzler Special', name: 'Fire Chicken Creamy Kebab', is_veg: 0, price: 180, description: '3 Pc' },

  // ===== BREADS & NAAN =====
  { category: 'Breads & Naan', name: 'Tandoori Roti', is_veg: 1, price: 10 },
  { category: 'Breads & Naan', name: 'Tandoori Butter Roti', is_veg: 1, price: 15 },
  { category: 'Breads & Naan', name: 'Plain Naan', is_veg: 1, price: 25 },
  { category: 'Breads & Naan', name: 'Butter Naan', is_veg: 1, price: 35 },
  { category: 'Breads & Naan', name: 'Garlic Naan', is_veg: 1, price: 50 },
  { category: 'Breads & Naan', name: 'Laccha Paratha', is_veg: 1, price: 30 },
  { category: 'Breads & Naan', name: 'Masala Kulcha', is_veg: 1, price: 30 },
  { category: 'Breads & Naan', name: 'Missi Roti', is_veg: 1, price: 20 },
  { category: 'Breads & Naan', name: 'Rumali Roti', is_veg: 1, price: 15 },

  // ===== BEVERAGES =====
  { category: 'Beverages', name: 'Tea', is_veg: 1, price: 20 },
  { category: 'Beverages', name: 'Coffee', is_veg: 1, price: 40 },
  { category: 'Beverages', name: 'Cold Drinks', is_veg: 1, price: 40, description: 'MRP' },
  { category: 'Beverages', name: 'Mineral Water', is_veg: 1, price: 20, description: 'MRP' },
  { category: 'Beverages', name: 'Lassi', is_veg: 1, price: 40 },

  // ===== DESSERTS =====
  { category: 'Desserts', name: 'Gulab Jamun', is_veg: 1, price: 40, description: '2 Pc' },
];

async function seedMenu() {
  try {
    console.log('Restaurants dhoond raha hoon...');
    const restRes = await axios.get(API_URL + '/api/restaurants');
    const restaurant = restRes.data.find(r => r.name.toLowerCase().includes('zafira'));

    if (!restaurant) {
      console.log('❌ Al-Zafira restaurant nahi mila! Pehle Admin panel se restaurant add karo.');
      return;
    }

    console.log('✅ Mil gaya: ' + restaurant.name + ' (ID: ' + restaurant.id + ')');
    console.log('Menu add kar raha hoon — ' + menu.length + ' items...\n');

    let successCount = 0;
    for (const item of menu) {
      try {
        const basePrice = item.portions ? item.portions[0].price : item.price;
        await axios.post(API_URL + '/api/menu/add', {
          restaurant_id: restaurant.id,
          category: item.category,
          name: item.name,
          price: basePrice,
          description: item.description || '',
          is_veg: item.is_veg,
          portions: item.portions || null,
          image: categoryImages[item.category] || categoryImages['default'],
        });
        successCount++;
        console.log('  ✅ ' + item.name);
        await new Promise((resolve) => setTimeout(resolve, 300));
      } catch (e) {
        console.log('  ❌ Failed: ' + item.name);
      }
    }

    console.log('\n🎉 Done! ' + successCount + '/' + menu.length + ' items add ho gaye.');
  } catch (e) {
    console.error('Error:', e.message);
  }
}

seedMenu();
