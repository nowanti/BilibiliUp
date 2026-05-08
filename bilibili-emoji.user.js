// ==UserScript==
// @name         Bilibili 充电表情
// @namespace    https://github.com/abcdefghHIM/BilibiliUp
// @version      1.2.5
// @description  哔哩哔哩充电表情包 - 在直播间、空间、视频页添加充电表情页
// @author       abcdefghHIM
// @match        https://live.bilibili.com/*
// @match        https://space.bilibili.com/*
// @match        https://www.bilibili.com/video/*
// @grant        none
// @run-at       document-idle
// @homepage     https://github.com/abcdefghHIM/BilibiliUp
// ==/UserScript==

(async function () {
    'use strict';

    let cachedPreloadEmoji = null;
    const EMOTE_API_PATH = "api.bilibili.com/x/emote/user/panel/web";
    const TARGET_RIGHT_API = "api.bilibili.com/x/upowerv2/gw/rights/guide";

    const originalFetch = window.fetch;

    const getUrlString = (resource) => {
        if (typeof resource === 'string') return resource;
        if (resource instanceof Request) return resource.url;
        if (resource instanceof URL) return resource.href;
        return String(resource);
    };

    const setupInterceptor = () => {
        if (typeof originalFetch !== 'function') return;

        window.fetch = async function (...args) {
            const url = getUrlString(args[0]);

            if (!url.includes(EMOTE_API_PATH)) {
                return originalFetch.apply(this, args);
            }

            try {
                const response = await originalFetch.apply(this, arguments);
                const ct = response.headers.get("content-type") || "";
                if (!cachedPreloadEmoji || !response.ok || !ct.includes("application/json")) {
                    return response;
                }

                const active = document.activeElement;
                const isCommentBox = !!(
                    active &&
                    (active.tagName?.includes("BILI-COMMENT") || active.closest?.("bili-comments"))
                );

                if (!isCommentBox) return response;

                const clonedResponse = response.clone();
                let json;
                try {
                    json = await clonedResponse.json();
                } catch {
                    return response;
                }

                if (json?.data?.packages) {
                    const hasAlready = json.data.packages.some(p => p.text === cachedPreloadEmoji.text);
                    if (!hasAlready) {
                        const insertIndex = Math.min(4, json.data.packages.length);
                        json.data.packages.splice(insertIndex, 0, cachedPreloadEmoji);
                    }
                }

                const modifiedText = JSON.stringify(json);
                const headers = new Headers(response.headers);
                headers.delete("content-length");

                return new Response(modifiedText, {
                    status: response.status,
                    statusText: response.statusText,
                    headers
                });
            } catch (err) {
                return originalFetch.apply(this, args);
            }
        };
    };

    const getCsrf = () => document.cookie.match(/bili_jct=([^;]+)/)?.[1] || "";

    const loadAndCache = async (mid, buildDataFn) => {
        const csrf = getCsrf();
        if (!csrf || !mid) return null;

        try {
            const params = new URLSearchParams({ csrf: csrf, up_mid: mid });
            const url = `https://${TARGET_RIGHT_API}?${params}`;
            const resp = await originalFetch(url, {
                method: "GET",
                credentials: "include",
                signal: AbortSignal.timeout?.(10000)
            });
            if (!resp.ok) return null;
            const res = await resp.json();

            if (res?.data?.rights) {
                let isLocked = true;
                let rawEmojis = [];

                for (const right of res.data.rights) {
                    for (const item of (right.right_list || [])) {
                        if (item.right_type === "medal") {
                            if (isLocked) {
                                isLocked = !!item.locked;
                            }
                        } else if (item.right_type === "emote") {
                            rawEmojis = item.list || [];
                        }
                    }
                }

                if (rawEmojis.length > 0) {
                    cachedPreloadEmoji = buildDataFn(rawEmojis, mid, isLocked);
                    return { rawEmojis, mid, isLocked };
                }
            }
        } catch (err) {
        }
    };

    const baseBuildData = (emos, mid) => {
        if (!Array.isArray(emos) || emos.length === 0) return null;

        const timestamp = Math.floor(Date.now() / 1000);

        return {
            attr: 2,
            flags: { added: true, preview: true },
            id: 1,
            label: null,
            meta: { size: 1, item_id: 0 },
            mtime: timestamp,
            package_sub_title: "",
            ref_mid: 0,
            resource_type: 0,
            text: "充电表情",
            type: 1,
            url: emos[0].icon,
            emote: emos.map(item => ({
                activity: null,
                attr: 0,
                flags: { unlocked: true },
                id: item.id,
                meta: { size: 2, alias: item.name },
                mtime: timestamp,
                package_id: 0,
                text: `[UPOWER_${mid}_${item.name}]`,
                type: 3,
                url: item.icon
            }))
        };
    };

    // --- Page handlers ---

    async function handleVideo() {
        const mid = window.__INITIAL_STATE__?.upData?.mid;
        if (!mid) return;
        await loadAndCache(mid, baseBuildData);
    }

    async function handleSpace() {
        const mid = window.location.pathname.split('/')[1];
        if (!mid) return;
        await loadAndCache(mid, baseBuildData);
    }

    async function handleLive() {
        const patchWebpack = () => {
            if (!self.webpackChunklive_room) return;

            const oldPush = self.webpackChunklive_room.push;

            self.webpackChunklive_room.push = function (chunk) {
                const modules = chunk[1];
                for (const id in modules) {
                    if (!modules.hasOwnProperty(id)) continue;

                    const originalModule = modules[id];
                    const source = originalModule.toString();

                    const match = source.match(/this\.emoticonsList\s*=\s*([a-zA-Z0-9_$]+)\.data\s*\|\|\s*\[\]/);
                    if (match) {
                        const objName = match[1];
                        modules[id] = function (t, e, r) {
                            let source = originalModule.toString();
                            const targetStr = match[0];

                            const injectLogic = `(function (data) {
    if (window.preloadEmoji) {
        try {
            const protoPkg = data[0];
            const myPkg = Object.assign(Object.create(Object.getPrototypeOf(protoPkg)), protoPkg);

            myPkg.current_cover = window.preloadEmoji.current_cover;
            myPkg.pkg_descript = "充电表情";
            myPkg.pkg_id = 1;
            myPkg.pkg_name = "充电表情";
            myPkg.pkg_perm = 1;
            myPkg.pkg_type = 5;
            myPkg.recently_used_emoticons = [];

            const protoEmoji = myPkg.emoticons[0];

            myPkg.emoticons = [];

            for (const emoji of window.preloadEmoji.emoticons) {
                const myEmoji = Object.assign(Object.create(Object.getPrototypeOf(protoEmoji)), protoEmoji);
                myEmoji.bulge_display = 1;
                myEmoji.descript = emoji.descript;
                myEmoji.emoji = emoji.emoji;
                myEmoji.emoticon_id = emoji.emoticon_id;
                myEmoji.emoticon_unique = emoji.emoticon_unique;
                myEmoji.emoticon_value_type = emoji.emoticon_value_type;
                myEmoji.height = emoji.height;
                myEmoji.identity = emoji.identity;
                myEmoji.in_player_area = emoji.in_player_area;
                myEmoji.is_dynamic = emoji.is_dynamic;
                myEmoji.perm = emoji.perm;
                myEmoji.url = emoji.url;
                myEmoji.width = emoji.width;
                myPkg.emoticons.push(myEmoji);
            }

            data.splice(Math.min(data.length, 3), 0, myPkg);
        }
        catch (err) {

        }

    }
})(${objName}.data),`;

                            source = source.replace(targetStr, injectLogic + targetStr);

                            return new Function('t', 'e', 'r', `(${source})(t, e, r)`)(t, e, r);
                        };
                    }
                }
                return oldPush.apply(this, arguments);
            };
        };

        patchWebpack();

        const buildLiveData = (emos, mid, perm) => {
            if (!Array.isArray(emos) || emos.length === 0) return null;

            return {
                current_cover: emos[0].icon,
                pkg_descript: "充电表情",
                pkg_name: "充电表情",
                pkg_perm: 1,
                pkg_type: 5,
                pkg_id: 1,
                unlock_identity: 0,
                unlock_need_gift: 0,
                top_show: {
                    top_left: { image: "", text: "" },
                    top_right: { image: "", text: "" }
                },
                emoticons: emos.map(item => ({
                    bulge_display: 1,
                    descript: item.name,
                    emoji: item.name,
                    emoticon_unique: `upower_[UPOWER_${mid}_${item.name}]`,
                    emoticon_value_type: 1,
                    identity: 99,
                    in_player_area: 1,
                    perm: perm,
                    url: item.icon,
                    is_dynamic: 0,
                    width: 162,
                    height: 162,
                    unlock_need_gift: 0,
                    unlock_need_level: 0,
                    unlock_show_color: "",
                    unlock_show_image: "",
                    unlock_show_text: "",
                    emoticon_id: item.id
                })),
                recently_used_emoticons: []
            };
        };

        const mid = window.__NEPTUNE_IS_MY_WAIFU__?.roomInfoRes?.data?.room_info?.uid;
        if (!mid) return;
        await loadAndCache(mid, (emos, mid, locked) => {
            window.preloadEmoji = buildLiveData(emos, mid, locked ? 0 : 1);
            return baseBuildData(emos, mid);
        });
    }

    // --- Main ---

    try {
        setupInterceptor();
    } catch (err) { return; }

    const href = window.location.href;

    if (href.includes('live.bilibili.com')) {
        await handleLive();
    } else if (href.includes('space.bilibili.com')) {
        await handleSpace();
    } else if (href.includes('www.bilibili.com/video')) {
        await handleVideo();
    }
})();
