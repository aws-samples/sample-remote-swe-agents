import * as playwright from 'playwright';
import sharp from 'sharp';
import { Page } from 'playwright';
import { writeFileSync } from 'fs';
import { NodeHtmlMarkdown } from 'node-html-markdown';
import * as prettier from 'prettier';
import { truncate } from '../../common/lib';
import { setTimeout } from 'timers/promises';

export class Screen {
  private page: Page;
  private mousePosition = { x: 0, y: 0 };

  private constructor(page: Page) {
    this.page = page;
  }

  public static async init(height: number, width: number) {
    const browser = await playwright['chromium'].launch({
      ignoreDefaultArgs: ['--hide-scrollbars'],
    });

    const context = await browser.newContext({
      viewport: { width, height },
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36 Edg/133.0.0.0',
    });
    await context.addInitScript("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})");

    const page = await context.newPage();
    return new Screen(page);
  }

  public async close() {
    await this.page.context().close();
  }

  public async goto(url: string) {
    await this.page.goto(url);
  }

  /**
   * Press keyboard keys
   * @param text Key combination (e.g., "ctrl+s", "Return")
   */
  public async key(text: string): Promise<void> {
    const keys = text.split('+');
    if (keys.length > 1) {
      // For key combination
      await this.page.keyboard.press(text);
    } else {
      // For single key
      await this.page.keyboard.press(text);
    }
  }

  /**
   * Input text
   * @param text Text to input
   */
  public async type(text: string): Promise<void> {
    await this.page.keyboard.type(text);
  }

  /**
   * Get cursor position
   * @returns {Promise<{x: number, y: number}>} Cursor coordinates
   */
  public async cursorPosition(): Promise<{ x: number; y: number }> {
    return this.mousePosition;
  }

  /**
   * Move mouse to specified coordinates
   * @param x X coordinate
   * @param y Y coordinate
   */
  public async mouseMove(x: number, y: number): Promise<void> {
    this.mousePosition = { x, y };
    await this.page.mouse.move(x, y);
  }

  /**
   * Hold down keys for a specified duration
   * @param text Key combination
   * @param duration Duration to hold keys (in seconds)
   */
  public async holdKey(text: string, duration: number): Promise<void> {
    const keys = text.split('+');
    for (const key of keys) {
      await this.page.keyboard.down(key);
    }
    await this.wait(duration);
    for (const key of keys.reverse()) {
      await this.page.keyboard.up(key);
    }
  }

  /**
   * Press left mouse button
   */
  public async leftMouseDown(): Promise<void> {
    await this.page.mouse.down();
  }

  /**
   * Release left mouse button
   */
  public async leftMouseUp(): Promise<void> {
    await this.page.mouse.up();
  }

  /**
   * Left click at specified coordinates (optionally while holding down keys)
   * @param x X coordinate
   * @param y Y coordinate
   * @param keys Keys to hold down simultaneously (optional)
   */
  public async leftClick(x: number, y: number, keys?: string): Promise<void> {
    if (keys) {
      const keyArray = keys.split('+');
      for (const key of keyArray) {
        await this.page.keyboard.down(key);
      }
    }
    await this.mouseMove(x, y);
    await this.page.mouse.click(x, y, { button: 'left' });

    if (keys) {
      const keyArray = keys.split('+');
      for (const key of keyArray.reverse()) {
        await this.page.keyboard.up(key);
      }
    }
  }

  /**
   * Perform triple click
   * @param x X coordinate
   * @param y Y coordinate
   */
  public async tripleClick(x: number, y: number): Promise<void> {
    await this.mouseMove(x, y);
    await this.page.mouse.dblclick(x, y);
    await this.page.mouse.click(x, y);
  }

  /**
   * Perform scroll
   * @param x X coordinate
   * @param y Y coordinate
   * @param direction Scroll direction
   * @param amount Scroll amount (#clicks)
   * @param keys Keys to hold down simultaneously (optional)
   */
  public async scroll(
    x: number,
    y: number,
    direction: 'up' | 'down' | 'left' | 'right',
    amount: number,
    keys?: string
  ): Promise<void> {
    await this.page.mouse.move(x, y);
    amount *= 100; // number of clicks to pixels

    if (keys) {
      const keyArray = keys.split('+');
      for (const key of keyArray) {
        await this.page.keyboard.down(key);
      }
    }

    const deltaX = direction === 'left' ? -amount : direction === 'right' ? amount : 0;
    const deltaY = direction === 'up' ? -amount : direction === 'down' ? amount : 0;
    await this.page.mouse.wheel(deltaX, deltaY);

    if (keys) {
      const keyArray = keys.split('+');
      for (const key of keyArray.reverse()) {
        await this.page.keyboard.up(key);
      }
    }
  }

  /**
   * Wait for specified duration
   * @param duration Wait time (in seconds)
   */
  public async wait(duration: number): Promise<void> {
    await setTimeout(duration * 1000);
  }

  /**
   * Perform drag operation (from start coordinates to end coordinates)
   * @param startX Start X coordinate
   * @param startY Start Y coordinate
   * @param endX End X coordinate
   * @param endY End Y coordinate
   */
  public async leftClickDrag(startX: number, startY: number, endX: number, endY: number): Promise<void> {
    await this.mouseMove(startX, startY);
    await this.page.mouse.down();
    await this.mouseMove(endX, endY);
    await this.page.mouse.up();
  }

  /**
   * Perform right click
   */
  public async rightClick(): Promise<void> {
    await this.page.mouse.click((await this.cursorPosition()).x, (await this.cursorPosition()).y, { button: 'right' });
  }

  /**
   * Perform middle click
   */
  public async middleClick(): Promise<void> {
    await this.page.mouse.click((await this.cursorPosition()).x, (await this.cursorPosition()).y, { button: 'middle' });
  }

  /**
   * Perform double click
   */
  public async doubleClick(): Promise<void> {
    await this.page.mouse.dblclick((await this.cursorPosition()).x, (await this.cursorPosition()).y);
  }

  /**
   * Take screenshot
   * @returns {Promise<Buffer>} Screenshot buffer
   */
  public async screenshot(): Promise<Buffer> {
    const screenshotBuffer = await this.page.screenshot();

    // Generate cursor image
    const cursorSize = 20;
    const cursorBuffer = await this.createCursor(cursorSize);

    // Get screenshot dimensions
    const metadata = await sharp(screenshotBuffer).metadata();
    const width = metadata.width || 0;
    const height = metadata.height || 0;

    // Adjust cursor position (handling cases near image edges)
    const cursorX = Math.min(Math.max(this.mousePosition.x, 0), width - cursorSize);
    const cursorY = Math.min(Math.max(this.mousePosition.y, 0), height - cursorSize);

    // Composite screenshot and cursor
    const compositeImage = await sharp(screenshotBuffer)
      .composite([
        {
          input: cursorBuffer,
          top: cursorY,
          left: cursorX,
        },
      ])
      .png()
      .toBuffer();
    writeFileSync('ss.png', compositeImage);

    return compositeImage;
  }

  public async scrapeWebpage(url: string, maxLength = 80_000) {
    const page = await this.page.context().newPage();
    const findMainContentToHtml = async (page: Page) => {
      const locators = [
        'main', // most pages should use main tag
        'div.mainContainer', // CDK API reference
      ];
      for (const locator of locators) {
        const mainContent = page.locator(locator);
        if ((await mainContent.count()) == 1) {
          return await mainContent.innerHTML();
        }
      }
      return await page.content();
    };

    try {
      await page.goto(url);
      const htmlText = await findMainContentToHtml(page);

      const markdown = new NodeHtmlMarkdown().translate(htmlText);

      // minify markdown tables
      const formattedMarkdown = await prettier.format(markdown, {
        printWidth: 100,
        parser: 'markdown',
        proseWrap: 'never',
      });

      // Truncate if over max length
      const truncatedMarkdown = truncate(formattedMarkdown, maxLength, 0.5);

      return {
        length: formattedMarkdown.length,
        markdown: truncatedMarkdown,
      };
    } finally {
      await page.close();
    }
  }

  public async getCurrentUrl() {
    // it takes some time to reflect page.url after a navigation, so wait for 5s.
    await setTimeout(5000);
    return this.page.url();
  }

  private async createCursor(size: number): Promise<Buffer> {
    // Draw cursor in SVG
    const cursorSVG = `
      <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
        <!-- Red circle -->
        <circle 
          cx="${size / 2}" 
          cy="${size / 2}" 
          r="${size / 2 - 2}" 
          fill="rgba(255, 0, 0, 0.8)"
          stroke="red"
          stroke-width="2"/>
      </svg>
    `;

    // Convert SVG to buffer
    const cursorBuffer = await sharp(Buffer.from(cursorSVG)).toBuffer();

    return cursorBuffer;
  }
}
