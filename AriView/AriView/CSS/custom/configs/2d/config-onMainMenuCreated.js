(function() {

    window.hteditor_config.onMainMenuCreated = function(editor, params) {
        var S = hteditor.getString;
        var mainMenu = editor.mainMenu;

        // Add some items on main menu
        var items = [
                {
                    label: S('Hightopo'),
                    items: [
                        {
                            label: S('Home'),
                            action: function() { window.open('http://www.hightopo.com'); }
                        },
                        {
                            label: S('GetStarted'),
                            action: function() { window.open('http://www.hightopo.com/guide/guide/core/beginners/ht-beginners-guide.html'); }
                        },
                        {
                            label: S('Blog'),
                            action: function() { window.open('http://www.hightopo.com/blog'); }
                        },
                        {
                            label: S('Guide'),
                            action: function() { window.open('http://www.hightopo.com/guide/readme.html'); }
                        }
                    ]
                },
                {
                    label: S('ContactUs'),
                    action: function() { window.open('mailto:service@hightopo.com'); }
                }
        ];
        if (!isPracticing) {
            items = items.concat([
                'separator',
                {
                    label: S('Readme'),
                    action: function() { window.open('../help/readme.txt'); }
                }
            ]);
        }
        mainMenu.getItems().push({
            label: S('Help'),
            items: items
        });
    };

})();
























