import { createApp } from 'vue';
import { createPinia } from 'pinia';
import GameView from './ui/GameView.vue';

createApp(GameView).use(createPinia()).mount('#app');
