// ==UserScript==
// @name         9gag show profile age
// @version      0.4.1
// @updateURL    https://raw.githubusercontent.com/andiabrudan/TamperScripts/master/9gag.js
// @downloadURL  https://raw.githubusercontent.com/andiabrudan/TamperScripts/master/9gag.js
// @supportURL   https://github.com/andiabrudan/TamperScripts/issues
// @description  Script to retrieve an account's age from their profile and show it adjacent to the post they created
// @author       Andi
// @match        https://9gag.com/*
// @icon         https://9gag.com/favicon.ico
// @grant        none
// @run-at       document-idle
// ==/UserScript==

'use strict';

const HEADER_MAIN_PATH = "header > div > div.ui-post-creator";
const HEADER_AUTHOR_PATH = "header > div > div.ui-post-creator > a.ui-post-creator__author";

const VERIFY_MESSAGE = "Manually verify the user. \
Turns the text to green even for young accounts. \
Useful for avoiding false positives.";

const UNVERIFY_MESSAGE = "Unverify the user. \
If you accidentally verified a user, just click \
here to revert the status.";

const BOT_WARNING_MESSAGE = "This user is likely a bot. \
This has been determined by looking at the user's recent history. \
There are a large number of articles posted in a short amount of time, \
typical of bot activity. Please manually review before blocking. \
\n\nHeuristic method used to identify potential bots is based on \
the timespan between their recent posts, where a span of less than 12h \
over the last 10 posts indicates bot-like behaviour.";

function get_user_cache(accountURL)
{
  const cachedItem = localStorage.getItem(accountURL);
  if (!cachedItem) return false;

  const json = JSON.parse(cachedItem);

  const expiry = new Date(json.date + 12 * 60 * 60 * 1000);

  return {days: json.days,
          verified: json.verified || false,
          expired: expiry < new Date(),
          isBot: json.is_bot || false};
}

function set_user_cache(accountURL, days, isBot)
{
    let json = {
        "days": days,
        "is_bot": isBot,
        "date": Date.now()
    }
    localStorage.setItem(accountURL, JSON.stringify(json));
}

function mark_user_verified_cache(accountURL, verifiedStatus)
{
    const cachedItem = localStorage.getItem(accountURL);
    if (!cachedItem) return false;

    const json = JSON.parse(cachedItem);
    json.verified = verifiedStatus;
    if (verifiedStatus && json.is_bot) {
        json.is_bot = false;
    }
    localStorage.setItem(accountURL, JSON.stringify(json));
}

Function.prototype.bindBack = function(fn, ...bound_args) {
    return function(...args) {
        return fn(...args, ...bound_args);
    };
}

/**
 * Waits for an element to appear in the DOM then returns it.
 * @param {string} elemId The ID of the element that should be awaited
 * @returns {Promise} A promise that will eventually resolve to the element with the given ID
 */
async function wait_elem(elemId)
{
    return new Promise(resolve => {
        let mutObs = new MutationObserver((_, me) => {
            let element = document.getElementById(elemId);
            if (element) {
                me.disconnect();
                resolve(element);
            }
        });
        mutObs.observe(document.body, {subtree: true, childList: true});
    });
}

/**
 * Watch the children of a given element and call a function for every new one that spawns.
 * @param {HTMLElement} element The element whose children should be watched
 * @param {function} callback A callback that will be called with every immediate child of the watched element
 * @returns {void}
 */
function watch_children(element, callback)
{
    const mutObs = new MutationObserver((mutations_list, me) => {
        // Stop observing if element is destroyed
        if (!element) {
            me.disconnect();
            return;
        }
        for (const mutation of mutations_list) {
            if (mutation.addedNodes){
                mutation.addedNodes.forEach(node => {
                    if (node instanceof HTMLElement) {
                        callback(node);
                    }
                });
            }
        }
    });
    mutObs.observe(element, {childList: true})
}

/**
 * Processes a batch of 9gag posts nested under a single batch element.
 * Installs an observer on the batch element so that any new asynchronously added
 * elements will be processed as well.
 * @param {HTMLElement} batchElem 
 */
async function process_batch(batchElem)
{
    for (const postElem of batchElem.children) {
        process_single(postElem);
    }
    watch_children(batchElem, process_single);
}

/**
 * Makes an HTTP request to a given address and returns a parsed json of the information retrived.
 * @param {string} accountURL A URL to a user profile
 * @returns A json object containing information about the user, or false if the request fails.
 */
async function request_user_profile(accountURL)
{
    console.log("Fetching from ", accountURL);
    const response = await fetch(accountURL);
    if (!response.ok) {
        return false;
    }

    const wholePage = await response.text();
    // Extract the part that has JSON.parse(...)
    const regex = /JSON\.parse\(".+"\);/s;
    const jsonParse = regex.exec(wholePage)[0];
    // Execute the string extracted. Should be valid JS
    const json = eval(jsonParse); // eslint-disable-line no-eval
    return json;
}

/**
 * Processes a single post. Gets the URL of the user from the post and retrieves information from it,
 * then modifies the post by adding the information next to their name.
 * @param {HTMLElement} userURL An <article> that is a 9gag post
 */
async function process_single(postElem)
{
    // Early exit if the element is not an 9gag article
    if (postElem.tagName !== 'ARTICLE' || !postElem.id.startsWith("jsid-post-")) {
        return;
    }

    const accountURL = postElem.querySelector(HEADER_AUTHOR_PATH).href;
    const accountId = accountURL.substring("https://9gag.com/u/".length);
    // Hidden users have 'javascript:void' instead of an url
    if (accountURL === "javascript:void(0);") {
        return;
    }

    const cacheResult = get_user_cache(accountURL);
    const isCached = (typeof cacheResult === "object");
    let days, verified, expired;
    if (isCached) {
        ({days, verified, expired} = cacheResult);
    }

    if (!isCached || expired) {
        const json = await request_user_profile(accountURL);
        if (json) {
            const createdTs = json.data.profile.creationTs;

            const likelyBot = analyze_user_posts(json.data.posts);

            // Convert to days past since
            days = new Date() - new Date(createdTs * 1000);
            days = Math.ceil(days / (1000 * 3600 * 24));

            set_user_cache(accountURL, days, likelyBot);
            build_and_append_extra_header(postElem, accountURL, days, false, likelyBot);
        }
        else {
            let errElem = build_element_errorMsg(accountURL);
            postElem.querySelector(HEADER_MAIN_PATH).append(errElem);
        }
    }
    else /*user is cached and not expired*/ {
        build_and_append_extra_header(postElem, accountURL, days, verified);
    }
}

function analyze_user_posts(postsJSON) {
    // We get a maximum of 10 posts to work with
    // Users with few posts are unlikely to be bots
    if (postsJSON.length < 7)
        return false;

    let cumulativeDelta = 0;
    let lastPostTs = postsJSON[0].creationTs;
    for (let i = 1; i < postsJSON.length; i++) {
        const currentPostTs = postsJSON[i].creationTs;
        cumulativeDelta += lastPostTs - currentPostTs;
        lastPostTs = currentPostTs;
    }

    const THRESHOLD_INTERVAL = 6 * 60 * 60;
    if ((cumulativeDelta / postsJSON.length) < THRESHOLD_INTERVAL){
        return true;
    }
    else {
        return false;
    }
}

function build_and_append_extra_header(parentElem, accountURL, days, verified, likelyBot = false)
{
    const divContainer = document.createElement("div");

    const elemDaysOld = build_element_daysOld(days, verified);
    divContainer.appendChild(elemDaysOld);

    const elemVerified = build_element_verified(parentElem, divContainer, accountURL, days, verified);
    divContainer.appendChild(elemVerified);

    if (likelyBot && !verified) {
        const elemLikelyBot = build_element_likelyBot();
        divContainer.appendChild(elemLikelyBot);
    }

    const postHeader = parentElem.querySelector(HEADER_MAIN_PATH);
    postHeader.append(divContainer);
}

function build_element_likelyBot()
{
    const message = "Likely Bot!";
    const fontSize = 14;
    const color = "orange";
    const extraStyle = "margin-left: 10px;";
    const element = create_text_element(message, fontSize, color, extraStyle);
    element.title = BOT_WARNING_MESSAGE;
    return element;
}

function build_element_verified(postElem, parentElem, accountURL, days, verified)
{
    verified = !verified;
    const element = document.createElement("button");
    element.style = "margin-left: 10px; background-color: #3C4043;";
    element.className = "user-script-tooltip-container";
    

    // const tooltipElem = document.createElement("span");
    // tooltipElem.className = "user-script-tooltip";

    // If the user is manually verified, display an X to cancel verification
    // Otherwise display a checkmark to verify. Note, the flag is inverted here.
    if (verified) {
        element.textContent = "\u2714";
        element.title = VERIFY_MESSAGE;
    }
    else {
        element.textContent = "\u274C";
        element.title = UNVERIFY_MESSAGE;
    }

    // Execute 3 functions on click.
    // 1. Set the user as verified in local storage
    // 2. Remove the old div in the header
    // 3. Recreate header
    element.onclick = () => {
        mark_user_verified_cache(accountURL, verified);
        parentElem.remove();
        build_and_append_extra_header(postElem, accountURL, days, verified);
    }
    return element;
}

function build_element_errorMsg(accountURL)
{
    const color = "orange";
    const fontSize = 14;
    const extraStyle = "margin-left: 10px";
    const message = "Request failed";
    const element = create_text_element(message, fontSize, color, extraStyle);
    element.id = accountURL;
    return element;
}

function build_element_daysOld(days, verified)
{
    let color = rgb_to_hex(...days_to_rgb(days));
    let fontSize = days < 100 ? 20 : 14;
    if (verified) {
        color = "#00FF00";
        fontSize = 14;
    }
    const extraStyle = "margin-left: 10px;"
    const message = `${days} days old`
    return create_text_element(message, fontSize, color, extraStyle);
}

function create_text_element(textContent, fontSize, color, extraStyle)
{
    const element = document.createElement("span");
    element.textContent = textContent;
    element.style = `color: ${color}; font-size: ${fontSize}px; ${extraStyle}`;
    return element;
}

function days_to_rgb(days)
{
    let red = 0;
    let green = 255;
    if (days < 1000) {
        green = Math.round(days / 1000 * 255);
        red = 255 - green;
    }
    return [red, green, 0];
}

function rgb_to_hex(red, green, blue)
{
    return "#" + (1 << 24 | red << 16 | green << 8 | blue).toString(16).slice(1);
}

async function main()
{
    // Find the list of posts
    const posts = await wait_elem("list-view-2");

    // Process children that were added before installing the observer
    for (const batchElem of posts.children) {
        process_batch(batchElem);
    }

    // Install a permanent mutation observer on the main container element
    // Then, install a mutation observer on any new batch container that is added.
    // Posts may load asynchronously in a batch.
    watch_children(posts, process_batch);
}

main();
