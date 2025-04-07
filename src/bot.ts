import { Telegraf } from "telegraf";
import axios from "axios";
import dotenv from "dotenv";
import { HfInference } from "@huggingface/inference";

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
  private readonly hfInference: HfInference;
  private readonly weatherApiKey: string;
  private userStates: Map<number, { awaitingCity: boolean }>;
  private normalizeCityName(city: string): string {
    return city
      .replace(/[^а-яёa-z-]/gi, "") // Удаляем все кроме букв и дефисов
      .replace(/(?:го|го|е|у|а|ом|ем|ах|ях)$/i, "") // Удаляем русские падежные окончания
      .trim();
  }

  constructor() {
    this.weatherApiKey = process.env.WEATHER_API_KEY || "";

    if (!process.env.TELEGRAM_BOT_TOKEN) {
      throw new Error("TELEGRAM_BOT_TOKEN не указан в .env");
    }

    this.bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
    this.hfInference = new HfInference(process.env.HUGGINGFACE_API_KEY); 
    this.userStates = new Map();
  }

  private async getCityFromMessage(message: string): Promise<string> {
    try {
      console.log("Полученное сообщение:", message);

      // Используем модель для извлечения именованных сущностей (NER)
      const response = await this.hfInference.tokenClassification({
        model: "Davlan/bert-base-multilingual-cased-ner-hrl",
        inputs: message,
      });

      // Ищем сущности типа LOC (место) или GPE (геополитическая сущность)
      const cityEntity = response.find(
        (entity) =>
          entity.entity_group === "LOC" || entity.entity_group === "GPE"
      );

      const city = cityEntity ? cityEntity.word.trim() : "";
      console.log("Извлеченный город:", city);
      return city;
    } catch (error) {
      console.error("Ошибка Hugging Face API:", error);
      return "";
    }
  }

  private async getWeather(city: string): Promise<WeatherData | null> {
    try {
      const normalizedCity = this.normalizeCityName(city);
      const response = await axios.get(
        `https://api.openweathermap.org/data/2.5/weather`,
        {
          params: {
            q: normalizedCity,
            units: "metric",
            appid: this.weatherApiKey,
            lang: "ru",
          },
          timeout: 5000,
        }
      );

      return {
        city: response.data.name,
        temp: Math.round(response.data.main.temp),
        feels_like: Math.round(response.data.main.feels_like),
        description: response.data.weather[0].description,
        humidity: response.data.main.humidity,
        windSpeed: response.data.wind.speed,
        icon: response.data.weather[0].icon,
      };
    } catch (error) {
      console.error("Ошибка получения погоды:", error);
      return null;
    }
  }

  private formatDefaultWeatherMessage(weather: WeatherData): string {
    const emojiMap: Record<string, string> = {
      "01d": "☀️",
      "01n": "🌙",
      "02d": "⛅",
      "02n": "⛅",
      "03d": "☁️",
      "03n": "☁️",
      "04d": "☁️",
      "04n": "☁️",
      "09d": "🌧️",
      "09n": "🌧️",
      "10d": "🌦️",
      "10n": "🌦️",
      "11d": "⛈️",
      "11n": "⛈️",
      "13d": "❄️",
      "13n": "❄️",
      "50d": "🌫️",
      "50n": "🌫️",
    };

    const emoji = emojiMap[weather.icon] || "🌍";

    return `
${emoji} <b>Погода в ${weather.city}</b> ${emoji}

🌡 Температура: <b>${weather.temp}°C</b> (ощущается как ${weather.feels_like}°C)
📝 Описание: <b>${weather.description}</b>
💧 Влажность: <b>${weather.humidity}%</b>
🌬 Ветер: <b>${weather.windSpeed} м/с</b>
    `.trim();
  }

  public start(): void {
    this.bot.start((ctx) => {
      ctx.replyWithHTML(
        `Привет! Я твой погодный помощник с ИИ 🌦️\n\n` +
          `Напиши мне название города, и я расскажу о погоде в нем.\n` +
          `Например: <i>"Какая погода в Москве?"</i> или просто <i>"Москва"</i>`
      );
    });

    this.bot.on("text", async (ctx) => {
      const userId = ctx.from?.id;
      if (!userId) return;

      try {
        const message = ctx.message.text;

        if (this.userStates.get(userId)?.awaitingCity) {
          this.userStates.delete(userId);
          const city = await this.getCityFromMessage(message);

          if (!city) {
            await ctx.reply(
              'Не удалось определить город. Попробуйте еще раз, например: <i>"Москва"</i>',
              {
                parse_mode: "HTML",
              }
            );
            return;
          }

          await ctx.replyWithChatAction("typing");
          const weather = await this.getWeather(city);

          if (!weather) {
            await ctx.reply(
              `Не удалось получить погоду для города ${city}. Попробуйте другой город.`
            );
            return;
          }

          const report = this.formatDefaultWeatherMessage(weather);
          await ctx.replyWithHTML(report);
          return;
        }

        const city = await this.getCityFromMessage(message);

        if (city) {
          await ctx.replyWithChatAction("typing");
          const weather = await this.getWeather(city);

          if (weather) {
            const report = this.formatDefaultWeatherMessage(weather);
            await ctx.replyWithHTML(report);
          } else {
            await ctx.reply(
              `Не удалось получить погоду для города ${city}. Попробуйте другой город.`
            );
          }
        } else {
          this.userStates.set(userId, { awaitingCity: true });
          await ctx.reply(
            "В каком городе вы хотите узнать погоду? Напишите название города:"
          );
        }
      } catch (error) {
        console.error("Ошибка обработки сообщения:", error);
        await ctx.reply("Произошла ошибка. Пожалуйста, попробуйте позже.");
      }
    });

    this.bot.launch();
    console.log("Бот запущен!");
  }
}

const weatherBot = new WeatherBot();
weatherBot.start();
