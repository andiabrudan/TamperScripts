// ==UserScript==
// @name         9gag show profile age
// @version      0.2.1
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

function get_user_cache(accountURL)
{
  const cachedItem = localStorage.getItem(accountURL);
  if (!cachedItem) return false;

  const json = JSON.parse(cachedItem);

  const expiry = new Date(json.date + 12 * 60 * 60 * 1000);

  return {days: json.days,
          verified: json.verified || false,
          expired: expiry < new Date()};
}

function set_user_cache(accountURL, days)
{
    let json = {
        "days": days,
        "date": Date.now()
    }
    localStorage.setItem(accountURL, JSON.stringify(json));
}

function mark_user_verified_cache()
{
    
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

    const accountURL = postElem.querySelector("header > div > div.ui-post-creator > a.ui-post-creator__author").href;
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

    let daysOldElement = null;
    let verifiedElement = null;
    if (!isCached || expired) {
        const json = await request_user_profile(accountURL);
        if (json) {
            const createdTs = json.data.profile.creationTs;

            // Convert to days past since
            days = new Date() - new Date(createdTs * 1000);
            days = Math.ceil(days / (1000 * 3600 * 24));

            set_user_cache(accountURL, days);
            daysOldElement = build_element_daysOld(days);
        }
        else {
            daysOldElement = build_element_errorMsg();
        }
    }
    else /*user is cached and not expired*/{
        daysOldElement = build_element_daysOld(days);
        verifiedElement = build_element_daysOld(days);
    }
    // Append new element to post
    const postHeader = postElem.querySelector("header > div > div.ui-post-creator");
    postHeader.append(daysOldElement);
}

function build_element_errorMsg()
{
    color = "orange";
    fontSize = 14;
    extraStyle = "margin-left: 10px";
    message = "Request failed";
    return create_text_element(message, fontSize, color, extraStyle);
}

function build_element_daysOld(days)
{
    const color = rgb_to_hex(...days_to_rgb(days));
    const fontSize = days < 100 ? 20 : 14;
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
