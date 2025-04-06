import cron from "node-cron";
import { Telegraf } from "telegraf";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

interface WeatherData {
  city: string;
  temp: number;
  feels_like: number;
  description: string;
  humidity: number;
  windSpeed: number;
  icon: string;
}

class WeatherBot {
  private readonly bot: Telegraf;
  private readonly apiKey: string;
  private readonly targetCity: string;
  private readonly chatId: string;

  constructor() {
    this.apiKey = process.env.WEATHER_API_KEY || "";
    this.targetCity = process.env.TARGET_CITY || "Москва";
    this.chatId = process.env.TELEGRAM_CHAT_ID || "";

    if (!process.env.TELEGRAM_BOT_TOKEN) {
      throw new Error("TELEGRAM_BOT_TOKEN не указан в .env");
    }

    this.bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
  }

  private async getWeather(): Promise<WeatherData> {
    try {
      if (!this.apiKey) {
        throw new Error("WEATHER_API_KEY не указан в .env");
      }

      const response = await axios.get(
        `https://api.openweathermap.org/data/2.5/weather`,
        {
          params: {
            q: this.targetCity,
            units: "metric",
            appid: this.apiKey,
            lang: "ru",
          },
          timeout: 5000, // 5 секунд таймаут
        }
      );

      if (response.status !== 200) {
        throw new Error(`API вернул статус ${response.status}`);
      }

      return {
        city: this.targetCity,
        temp: Math.round(response.data.main.temp),
        feels_like: Math.round(response.data.main.feels_like),
        description: response.data.weather[0].description,
        humidity: response.data.main.humidity,
        windSpeed: response.data.wind.speed,
        icon: response.data.weather[0].icon,
      };
    } catch (error) {
      console.error("Детали ошибки:", {
        city: this.targetCity,
        apiKey: this.apiKey ? "установлен" : "отсутствует",
        error: axios.isAxiosError(error) ? error.response?.data : error,
      });
      throw error;
    }
  }

  private formatWeatherMessage(weather: WeatherData): string {
    const emojiMap: Record<string, string> = {
      "01d": "☀️",
      "01n": "🌙", // ясно
      "02d": "⛅",
      "02n": "⛅", // малооблачно
      "03d": "☁️",
      "03n": "☁️", // облачно
      "04d": "☁️",
      "04n": "☁️", // пасмурно
      "09d": "🌧️",
      "09n": "🌧️", // дождь
      "10d": "🌦️",
      "10n": "🌦️", // ливень
      "11d": "⛈️",
      "11n": "⛈️", // гроза
      "13d": "❄️",
      "13n": "❄️", // снег
      "50d": "🌫️",
      "50n": "🌫️", // туман
    };

    const emoji = emojiMap[weather.icon] || "🌍";

    return `
${emoji} <b>Погода в ${weather.city}</b> ${emoji}

🌡 Температура: <b>${weather.temp}°C</b> (ощущается как ${weather.feels_like}°C)
📝 Описание: <b>${weather.description}</b>
💧 Влажность: <b>${weather.humidity}%</b>
🌬 Ветер: <b>${weather.windSpeed} м/с</b>

<i>${new Date().toLocaleDateString("ru-RU", {
      weekday: "long",
      day: "numeric",
      month: "long",
    })}</i>
    `.trim();
  }

  public async sendDailyWeather(): Promise<void> {
    try {
      const weather = await this.getWeather();
      await this.bot.telegram.sendMessage(
        this.chatId,
        this.formatWeatherMessage(weather),
        { parse_mode: "HTML" }
      );
      console.log(`Погода отправлена в чат ${this.chatId}`);
    } catch (error) {
      console.error(
        "Ошибка:",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  public start(): void {
    // Команда для ручной проверки
    this.bot.command("weather", async (ctx) => {
      try {
        const weather = await this.getWeather();
        await ctx.replyWithHTML(this.formatWeatherMessage(weather));
      } catch (error) {
        await ctx.reply("Ошибка при получении погоды 😢");
      }
    });

    this.bot.launch();
    console.log("Бот запущен!");
  }
}

const weatherBot = new WeatherBot();
weatherBot.start();

cron.schedule("0 7 * * *", () => weatherBot.sendDailyWeather());
