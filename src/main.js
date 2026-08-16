import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
import axios from 'axios';
import { fileURLToPath } from 'url';

function formatToISO(date) {
    return date.toISOString().replace('T', ' ').replace('Z', '').replace(/\.\d{3}Z/, '');
}

async function delayTime(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendTelegramMessage(token, chatId, message) {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const data = {
        chat_id: chatId,
        text: message
    };
    try {
        const response = await axios.post(url, data);
    } catch (error) {
        console.error('Telegram 消息发送失败:', error.message);  // [MODIFIED] 打印完整错误信息
    }
}

(async () => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const accounts = JSON.parse(fs.readFileSync(path.join(__dirname, '../accounts.json'), 'utf-8'));
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    const telegramChatId = process.env.TELEGRAM_CHAT_ID;

    for (const account of accounts) {
        const { username, password, panel } = account;

        const browser = await puppeteer.launch({ 
            headless: false, 
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-infobars',
                '--disable-blink-features=AutomationControlled'
            ],
            defaultViewport: null,
            ignoreHTTPSErrors: true
        });
        const page = await browser.newPage();

        let url = `https://${panel}/login/?next=/`;

        try {
            await page.goto(url);

            const usernameInput = await page.$('input[name="username"]');
            if (usernameInput) {
                await usernameInput.click({ clickCount: 3 });
                await usernameInput.press('Backspace');
            }
            await page.type('input[name="username"]', username);
            await page.type('input[name="password"]', password);

            // [DEBUG] 检查输入框实际值，排查是输入失败还是网站风控
            const userVal = await page.$eval('input[name="username"]', el => el.value);
            const passVal = await page.$eval('input[name="password"]', el => el.value);
            console.log('[DEBUG] 用户名框实际内容:', userVal);
            console.log('[DEBUG] 密码框实际长度:', passVal.length);

            const loginButton = await page.$('div.login-form__button button[type="submit"]');
            
            if (!loginButton) throw new Error('无法找到登录按钮');
            await loginButton.click();

            await page.waitForNavigation();

            const isLoggedIn = await page.evaluate(() => {
                const logoutButton = document.querySelector('a[href="/logout/"]');
                return logoutButton !== null;
            });

            if (isLoggedIn) {
                const nowUtc = formatToISO(new Date());
                const nowBeijing = formatToISO(new Date(new Date().getTime() + 8 * 60 * 60 * 1000)); // 北京时间东8区
                if (telegramToken && telegramChatId) {
                    await sendTelegramMessage(telegramToken, telegramChatId, `账号 ${username} 于北京时间 ${nowBeijing}（UTC时间 ${nowUtc}）登录成功！`);
                }
            } else {
                // [DEBUG] 截图+打印当前URL，排查登录失败原因
                const currentUrl = page.url();
                console.error(`[DEBUG] 登录失败 - 当前页面URL: ${currentUrl}`);
                const screenshotPath = path.join(__dirname, `../screenshot_${username}.png`);
                await page.screenshot({ path: screenshotPath, fullPage: false });
                console.error(`[DEBUG] 截图已保存: ${screenshotPath}`);
                if (telegramToken && telegramChatId) {
                    await sendTelegramMessage(telegramToken, telegramChatId, `账号 ${username} 登录失败，请检查账号和密码是否正确。`);
                }
            }
        } catch (error) {
            if (telegramToken && telegramChatId) {
                await sendTelegramMessage(telegramToken, telegramChatId, `账号 ${username} 登录时出现错误: ${error.message}`);
            }
        } finally {
            await page.close();
            await browser.close();
            const delay = Math.floor(Math.random() * 5000) + 1000; // 随机延时1秒到5秒之间
            await delayTime(delay);
        }
    }
})();