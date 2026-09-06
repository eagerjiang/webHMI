#import <Foundation/Foundation.h>
#import <CoreGraphics/CoreGraphics.h>

int main(void) {
    @autoreleasepool {
        NSArray *windows = CFBridgingRelease(CGWindowListCopyWindowInfo(
            kCGWindowListOptionAll,
            kCGNullWindowID
        ));

        for (NSDictionary *window in windows) {
            NSString *owner = window[(id)kCGWindowOwnerName];
            if (![owner isEqualToString:@"Google Chrome"]) continue;

            NSNumber *windowID = window[(id)kCGWindowNumber];
            NSNumber *layer = window[(id)kCGWindowLayer];
            NSNumber *onScreen = window[(id)kCGWindowIsOnscreen];
            NSString *name = window[(id)kCGWindowName] ?: @"";
            NSDictionary *bounds = window[(id)kCGWindowBounds];
            NSData *json = [NSJSONSerialization dataWithJSONObject:@{
                @"id": windowID ?: @0,
                @"layer": layer ?: @0,
                @"onScreen": onScreen ?: @NO,
                @"name": name,
                @"bounds": bounds ?: @{},
            } options:0 error:nil];
            fwrite(json.bytes, 1, json.length, stdout);
            fputc('\n', stdout);
        }
    }
    return 0;
}
