import '@/app/styles.css'

import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from '@/app/App.vue'

const app = createApp(App)

app.use(createPinia())
app.mount('#app')
