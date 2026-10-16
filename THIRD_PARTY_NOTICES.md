# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported from the project below, under its own licence.

## aioflo

- Project: [aioflo](https://github.com/bachya/aioflo), the Python client of the
  Flo by Moen cloud used by the Home Assistant "Flo" integration.
- What is ported (rewritten in JavaScript in `src/flo/client.js`,
  `src/flo/model.js` and `src/constants.js`): the API endpoints, the legacy Flo
  and the Moen SSO sign-in flows (token lifetime, refresh token, user id), the
  request headers, the valve and system mode commands, the consumption request,
  the alarm catalog, and the "no water temperature sensor" placeholder rule.
- Test fixtures `test/fixtures/device-shutoff.json` and
  `test/fixtures/consumption.json` are derived from aioflo's test fixtures.
- Licence: MIT.

```
MIT License

Copyright (c) 2020-2026 Aaron Bach

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
