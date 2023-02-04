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
    if (expiry < new Date()) return false;

    console.log("Got cache hit for URL", accountURL);
    return json.days;
}

function set_user_cache(accountURL, days)
{
    let json = {
        "days": days,
        "date": Date.now()
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

    console.log("Now processing ", postElem.id);
    let days = 0;

    const accountURL = postElem.querySelector("header > div > div.ui-post-creator > a.ui-post-creator__author").href
    days = get_user_cache(accountURL);

    if (!days) {
        const response = await fetch(accountURL);
        if (response.ok) {
            // Read the html source of the user page
            const wholePage = await response.text();

            // Extract the part that has JSON.parse(...)
            const regex = /JSON\.parse\(".+"\);/s;
            const jsonParse = regex.exec(wholePage)[0];

            // Execute the string extracted. Should be valid JS
            const json = eval(jsonParse); // eslint-disable-line no-eval

            // Get account creation timestamp
            const createdTs = json.data.profile.creationTs;

            // Convert to days past since
            days = new Date() - new Date(createdTs * 1000);
            days = Math.ceil(days / (1000 * 3600 * 24));

            set_user_cache(accountURL, days);
        }
        else {
            days = "Request failed";
        }
    }
    // Append new element to post
    const postHeader = postElem.querySelector("header > div > div.ui-post-creator");
    postHeader.append(create_text_element(days));
}

function create_text_element(days)
{
    let color = "color: red"
    let fontSize = "font-size: 14px";

    if (typeof days == 'number') {
        // Convert days to RGB
        color = rgb_to_hex(...days_to_rgb(days));
        color = `color: ${color}`;
        fontSize = days < 100 ? 20 : 14;
        fontSize = `font-size: ${fontSize}px`;
    }

    let element = document.createElement("span");
	element.textContent = `${days} days old`;
    element.style = `margin-left: 10px; ${color}; ${fontSize}`;

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
