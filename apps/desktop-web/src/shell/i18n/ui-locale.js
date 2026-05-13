import { messages } from './messages.js';
import { supportedLocales } from './locale-types.js';
export function isTranslationKey(value) {
    return Object.prototype.hasOwnProperty.call(messages, value);
}
function interpolate(template, params) {
    if (!params) {
        return template;
    }
    return Object.entries(params).reduce((acc, [key, value]) => {
        const safeValue = value ?? '';
        return acc.split(`{${key}}`).join(String(safeValue));
    }, template);
}
export function t(locale, keyOrZh, paramsOrEn, maybeParams) {
    if (typeof keyOrZh === 'string' &&
        isTranslationKey(keyOrZh) &&
        (paramsOrEn === undefined || typeof paramsOrEn !== 'string')) {
        const entry = messages[keyOrZh];
        const template = entry[locale] ?? entry['en-US'];
        return interpolate(template, paramsOrEn);
    }
    const zh = String(keyOrZh);
    const en = typeof paramsOrEn === 'string' ? paramsOrEn : zh;
    const params = (typeof paramsOrEn === 'string'
        ? maybeParams
        : paramsOrEn);
    const template = locale === 'zh-CN' ? zh : en;
    return interpolate(template, params);
}
export function translateMaybeKey(locale, value) {
    if (value == null) {
        return value;
    }
    return isTranslationKey(value) ? t(locale, value) : value;
}
const localeLabels = {
    'zh-CN': '中文',
    'en-US': 'English',
};
export const localeOptions = supportedLocales.map((value) => ({
    value,
    label: localeLabels[value],
}));
